// `logreq`: the command line adapter over the command catalog (ADR-0002, ADR-0009). It only translates
// transport: argv to a command input, the output to stdout, errors to stderr and an exit code.
import path from "node:path";
import type { CommandErrorClass, CommandErrorCode, CommandRuntime, InvokeContext } from "@logreq/core";
import {
  CommandError,
  PRODUCT_VERSION,
  Workspace,
  cacheFolder,
  errorClass,
  findWorkspaceRoot,
  getCommandRuntime,
  jsonLines,
  warmWorkspace,
  watchWorkspace,
} from "@logreq/core";
import { checkPort, refuseRunningApi, startApiServer } from "@logreq/api";
import { serveMcp } from "@logreq/mcp";
import { CommanderError } from "commander";
import type { InputStream } from "./input.js";
import { buildInput } from "./input.js";
import type { Invocation, ServeRequest } from "./program.js";
import { buildProgram } from "./program.js";
import { renderHuman } from "./present.js";
import { jsonOutput, outcomeExitCode, renderError, spelledMessage, yamlOutput } from "./render.js";

/** Exit codes of `logreq` (ADR-0009). */
export const EXIT = {
  /** Success without error findings. */
  ok: 0,
  /** A finding of severity error, or the command reports `ok: false`. */
  findings: 1,
  /** Usage or input error: every error class except `internal`. */
  usage: 2,
  /** Internal error. */
  internal: 3,
  /** A given commit is not available locally (SR-092 AK2: `git.commit-not-found`). */
  commitNotFound: 4,
  /** The call was aborted (Ctrl-C, SIGTERM): 128 + SIGINT, as shells report it. */
  aborted: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Exit code of each error class (ADR-0009 "Errors"). */
export const EXIT_BY_CLASS: Readonly<Record<CommandErrorClass, ExitCode>> = {
  input: EXIT.usage,
  "not-found": EXIT.usage,
  conflict: EXIT.usage,
  unavailable: EXIT.usage,
  "not-implemented": EXIT.usage,
  internal: EXIT.internal,
};

/** Error codes with an exit code of their own; all others get the one of their class. */
export const EXIT_BY_CODE: Readonly<Partial<Record<CommandErrorCode, ExitCode>>> = {
  "git.commit-not-found": EXIT.commitNotFound,
};

/** Exit code of a failed call: aborted, else by code, else by class. */
export const exitCodeFor = (
  error: CommandError,
  byCode: Readonly<Partial<Record<CommandErrorCode, ExitCode>>> = EXIT_BY_CODE,
): ExitCode =>
  error.details?.["aborted"] === true
    ? EXIT.aborted
    : (byCode[error.code] ?? EXIT_BY_CLASS[errorClass(error.code)]);

/** Where text goes; strings are written as UTF-8. */
export interface TextSink {
  /** `false` when the sink buffers more than it wants (then wait for `drained`) or is closed. */
  write(text: string): unknown;
  /**
   * After a write returned false: resolves true when the sink takes more, false when it is closed (the
   * rest of the output is dropped). A sink without it never pushes back.
   */
  drained?(): Promise<boolean>;
}

/**
 * Writes `pieces` to `sink` one by one, waiting for `drained` whenever a write returns false. Stops when
 * the sink is closed or `signal` aborts (Ctrl-C while a large output is written).
 */
/** `drained`, or false as soon as `signal` aborts (Ctrl-C while the reader does not read). */
const drainedOrAborted = (drained: Promise<boolean>, signal: AbortSignal | undefined): Promise<boolean> =>
  signal === undefined
    ? drained
    : new Promise((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        const onAbort = (): void => {
          resolve(false);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void drained.then((more) => {
          signal.removeEventListener("abort", onAbort);
          resolve(more);
        });
      });

export async function writePieces(
  sink: TextSink,
  pieces: Iterable<string>,
  signal?: AbortSignal,
): Promise<void> {
  for (const piece of pieces) {
    if (
      sink.write(piece) === false &&
      sink.drained !== undefined &&
      !(await drainedOrAborted(sink.drained(), signal))
    ) {
      return;
    }
    if (signal?.aborted === true) {
      return;
    }
  }
}

export interface RunCliOptions {
  /** Arguments after the program name. */
  readonly argv: readonly string[];
  /** Folder the command line runs in: start of the workspace discovery, base of relative paths. */
  readonly cwd: string;
  readonly stdin: InputStream;
  readonly stdout: TextSink;
  readonly stderr: TextSink;
  /** Default: the runtime of this process (`getCommandRuntime()`). Tests pass their own. */
  readonly runtime?: CommandRuntime;
  /** Aborts the running command and stops `serve api` and `mcp` (bin.ts: Ctrl-C and SIGTERM). */
  readonly signal?: AbortSignal;
}

/** `--workspace`, else the nearest folder with logreq-workspace.yaml, else the current folder (workspace init). */
const workspaceRoot = async (option: string | undefined, cwd: string): Promise<string> =>
  option === undefined ? ((await findWorkspaceRoot(cwd)) ?? cwd) : path.resolve(cwd, option);

const asCommandError = (error: unknown): CommandError =>
  error instanceof CommandError
    ? error
    : new CommandError("internal", "Internal error in the command line", undefined, { cause: error });

type Settled =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

const settle = (promise: Promise<unknown>): Promise<Settled> =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );

/** The workspace at `root`, with the model cache in the cache folder of the copy (ADR-0008, SR-082). */
const openWorkspace = (root: string): Workspace => new Workspace(root, { cacheFolder: cacheFolder(root) });

/** Run the command; the workspace is closed afterwards, and a failing close never hides the command's error. */
async function call(
  invocation: Invocation,
  options: RunCliOptions,
  runtime: CommandRuntime,
): Promise<unknown> {
  const input = await buildInput(invocation, options.cwd, options.stdin);
  const workspace = openWorkspace(await workspaceRoot(invocation.workspace, options.cwd));
  const context: InvokeContext =
    options.signal === undefined
      ? { workspace, access: "cli" }
      : { workspace, signal: options.signal, access: "cli" };
  const result = await settle(runtime.invoke(invocation.entry.name, input, context));
  const closed = await settle(workspace.close());
  if (!result.ok) {
    throw result.error;
  }
  if (!closed.ok) {
    throw closed.error;
  }
  return result.value;
}

async function execute(
  invocation: Invocation,
  options: RunCliOptions,
  runtime: CommandRuntime,
): Promise<ExitCode> {
  let output: unknown;
  try {
    output = await call(invocation, options, runtime);
  } catch (caught) {
    const error = asCommandError(caught);
    options.stderr.write(
      renderError(error, invocation.json || invocation.jsonl, spelledMessage(error, invocation.entry)),
    );
    return options.signal?.aborted === true ? EXIT.aborted : exitCodeFor(error);
  }
  await writePieces(
    options.stdout,
    invocation.json
      ? jsonOutput(output)
      : invocation.jsonl && invocation.entry.jsonLines !== undefined
        ? jsonLines(output, invocation.entry.jsonLines)
        : invocation.yaml
          ? yamlOutput(output)
          : [renderHuman(output, invocation.entry.effect === "read")],
    options.signal,
  );
  return options.signal?.aborted === true ? EXIT.aborted : outcomeExitCode(output);
}

/** Resolves when `signal` aborts. */
const stopped = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
    }
    signal.addEventListener("abort", () => {
      resolve();
    });
  });

/** `--port` as a number when it is one; anything else is refused by the API (`input.invalid`). */
const portNumber = (value: string | undefined): number =>
  value === undefined ? 0 : /^\d+$/.test(value) ? Number(value) : Number.NaN;

/** Run a server on the workspace until it is stopped; the workspace is closed afterwards. */
async function serveUntilStopped(
  request: ServeRequest,
  options: RunCliOptions,
  runtime: CommandRuntime,
  signal: AbortSignal,
): Promise<void> {
  const workspace = openWorkspace(await workspaceRoot(request.workspace, options.cwd));
  const served = await settle(
    (async () => {
      // A server keeps its workspace open: files changed outside the tool show without a restart (SR-007).
      // The workspace loads only once the folders are watched, so a change during the load is seen.
      const watching = watchWorkspace(workspace).ready;
      if (request.server === "mcp") {
        await watching;
        // The workspace loads while the client connects: a cold load (up to 30 s at 50,000 elements,
        // SR-082 AK2) must not hold up the handshake. The first tool call waits for it.
        void warmWorkspace(workspace);
        // Standard output carries the protocol: nothing else is written there.
        await serveMcp({ runtime, workspace, input: options.stdin, output: options.stdout, signal });
        return;
      }
      // A wrong port and a second API for the copy are refused before anything loads (ADR-0009).
      const port = checkPort(portNumber(request.port));
      await refuseRunningApi({ workspace });
      await watching;
      // The API listens once the workspace is loaded, so an answer means "usable" (SR-082 AK1, AK2).
      options.stderr.write("Loading the workspace...\n");
      await Promise.race([warmWorkspace(workspace), stopped(signal)]);
      if (signal.aborted) {
        return;
      }
      const server = await startApiServer({ runtime, workspace, port });
      options.stdout.write(
        `LogReq API on ${server.urls.join(" and ")}\nPort and token: ${server.endpointFile}\nStop with Ctrl-C.\n`,
      );
      await stopped(signal);
      await server.close();
    })(),
  );
  const closed = await settle(workspace.close());
  if (!served.ok) {
    throw served.error;
  }
  if (!closed.ok) {
    throw closed.error;
  }
}

/** A server ends with 0 when it is stopped (a signal, or the end of the MCP input); errors as for commands. */
async function serve(
  request: ServeRequest,
  options: RunCliOptions,
  runtime: CommandRuntime,
  signal: AbortSignal,
): Promise<ExitCode> {
  try {
    await serveUntilStopped(request, options, runtime, signal);
  } catch (caught) {
    const error = asCommandError(caught);
    options.stderr.write(renderError(error, false));
    return exitCodeFor(error);
  }
  return EXIT.ok;
}

/** Run `logreq` with these arguments and return the exit code. Never rejects. */
export async function runCli(options: RunCliOptions): Promise<ExitCode> {
  let exitCode: ExitCode = EXIT.ok;
  try {
    const runtime = options.runtime ?? getCommandRuntime();
    const program = buildProgram({
      runtime,
      version: PRODUCT_VERSION,
      writeOut: (text) => options.stdout.write(text),
      writeErr: (text) => options.stderr.write(text),
      jsonErrors: options.argv.includes("--json") || options.argv.includes("--jsonl"),
      run: async (invocation) => {
        exitCode = await execute(invocation, options, runtime);
      },
      serve: async (request) => {
        // Without a signal (in-process callers that never stop it) a server runs until the process ends.
        exitCode = await serve(request, options, runtime, options.signal ?? new AbortController().signal);
      },
    });
    await program.parseAsync([...options.argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version end with 0; every parse error (unknown command or option, missing group action) is usage.
      return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    }
    // A failure outside any command, e.g. writing the output failed. Its text may name paths: not shown.
    try {
      options.stderr.write(renderError(asCommandError(error), false));
    } catch {
      // stderr is gone too; the exit code is all that is left.
    }
    return EXIT.internal;
  }
  return exitCode;
}
