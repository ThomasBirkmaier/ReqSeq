// The one entry point of the adapters (CLI, API, MCP, app): `invoke(name, input, { workspace })`.
// Validates the input against the catalog, runs the command and maps every failure to a
// CommandError with a code from common.schema.json#/$defs/error (ADR-0002 rule 4). Adds the short
// ID of the element each problem of the output names (`withElementShortIds`, #315). Records the
// element of an API or MCP call as the last access of the copy (`recordAccess`, SR-117). Refuses the
// local paths of an API or MCP call outside the repositories of the workspace (SR-142).
import type { AnyCommand } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { commands as productCommands } from "../commands/index.js";
import { assertWritable } from "../metamodel/index.js";
import type { AccessCall, AccessName, NotedAccess } from "../model/activity.js";
import { FOLLOWED_ACCESSES, accessSubject, noteAccess, recordAccess } from "../model/activity.js";
import type { Contracts } from "./contracts.js";
import { SCHEMA_BASE, describeViolations, loadContracts, schemaViolations } from "./contracts.js";
import type { ProblemLocator } from "./element-short-ids.js";
import { problemLocator, withElementShortIds } from "./element-short-ids.js";
import { describeInputViolations, inputViolations } from "./input-errors.js";
import type { LocalPathField } from "./local-path-fields.js";
import { localPathFields, localPathUses } from "./local-path-fields.js";
import { OPEN_LOCAL_PATHS, confinedLocalPaths } from "../workspace/local-paths.js";
import type { Workspace } from "./workspace.js";

/** What an adapter passes per call. */
export interface InvokeContext {
  readonly workspace: Workspace;
  /** Abort when the caller goes away. Default: a signal that never aborts. */
  readonly signal?: AbortSignal;
  /**
   * The access the call comes through: each adapter passes its own name (ADR-0002 rule 4). It changes
   * the result in one way only: outside `UNCONFINED_ACCESSES` local paths must lie inside the
   * repositories of the workspace (SR-142, an exception to SR-080 AK2). Core records the element a successful call names as the last access of the
   * copy when the access is one of `FOLLOWED_ACCESSES` (API and MCP, SR-117) and the workspace has
   * a cache folder; left out, nothing is recorded and no path is confined (core tests, internal callers).
   */
  readonly access?: AccessName;
}

/**
 * The accesses that take every local path (SR-142 AK3): the command line and the app, whose paths a
 * person gives. Every other access, a future one too, takes only paths inside the repositories.
 */
export const UNCONFINED_ACCESSES: readonly AccessName[] = ["cli", "app"];

export interface CommandRuntimeOptions {
  /** Implementations to register. Default: all product commands (commands/index.ts). */
  readonly commands?: readonly AnyCommand[];
  /** Default: `loadContracts()` with the schemas of this repository. */
  readonly contracts?: Contracts;
  /**
   * Check every output against the catalog output schema; a mismatch is an `internal` error.
   * Default: on when the environment has `REQSEQ_VALIDATE_OUTPUT=1` (tests and debug builds).
   */
  readonly validateOutput?: boolean;
}

export interface CommandRuntime {
  readonly contracts: Contracts;
  /** Registered implementations by name. */
  readonly commands: ReadonlyMap<string, AnyCommand>;
  invoke(name: string, input: unknown, ctx: InvokeContext): Promise<unknown>;
}

/**
 * Any failure that is not a CommandError becomes `internal`. Its text stays only in `cause`
 * (logs, debugging): it may contain paths or content that adapters must not send.
 * An abort (the signal fired, or an `AbortError`) is `internal` too, with `details.aborted`;
 * the caller has gone away, so nobody acts on the code (ADR-0009).
 */
const toCommandError = (name: string, error: unknown, signal: AbortSignal): CommandError => {
  if (error instanceof CommandError) {
    return error;
  }
  if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
    return new CommandError(
      "internal",
      `${name} was aborted`,
      { command: name, aborted: true },
      { cause: error },
    );
  }
  return new CommandError("internal", `Internal error in ${name}`, { command: name }, { cause: error });
};

/**
 * Bind implementations to their catalog entries. Holds compiled schemas only, never workspace
 * state, so one runtime serves any number of workspaces. Throws a plain `Error` when an
 * implementation has no catalog entry or a name is registered twice (programming errors).
 */
export function createCommandRuntime(options: CommandRuntimeOptions = {}): CommandRuntime {
  const contracts = options.contracts ?? loadContracts();
  const validateOutput = options.validateOutput ?? process.env["REQSEQ_VALIDATE_OUTPUT"] === "1";
  const registry = new Map<string, AnyCommand>();
  // Write commands that are refused while the workspace is read-only (SR-011 AK3): the catalog
  // entry says so with `whileReadOnly` (ADR-0002 rule 5); read commands have no such field.
  const guarded = new Set<string>();
  // Write commands, which the watcher of the workspace waits for (`Workspace.writesSettled`, #432).
  const writers = new Set<string>();
  // Where the output of each command holds problems, from its output schema (#315); built on the
  // first call of the command, since a CLI process runs one (#319).
  const locators = new Map<string, () => ProblemLocator | undefined>();
  // Which element a call of each command names, from its catalog entry (SR-117).
  const calls = new Map<string, Omit<AccessCall, "access">>();
  // The local path fields of each command's input (SR-142), built on its first confined call.
  const pathFields = new Map<string, () => readonly LocalPathField[]>();
  for (const command of options.commands ?? productCommands) {
    const entry = contracts.entry(command.name);
    if (entry === undefined) {
      throw new Error(`command ${command.name} has no entry in schemas/commands/catalog.json`);
    }
    if (registry.has(command.name)) {
      throw new Error(`command ${command.name} is registered twice`);
    }
    registry.set(command.name, command);
    let located: { readonly locator: ProblemLocator | undefined } | undefined;
    locators.set(command.name, () => {
      located ??= {
        locator: problemLocator(
          entry.output,
          `${SCHEMA_BASE}commands/${command.name}.output.json`,
          contracts.schemas,
        ),
      };
      return located.locator;
    });
    let fields: readonly LocalPathField[] | undefined;
    pathFields.set(command.name, () => {
      fields ??= localPathFields(
        entry.input,
        `${SCHEMA_BASE}commands/${command.name}.input.json`,
        contracts.schemas,
      );
      return fields;
    });
    calls.set(command.name, { command: command.name, effect: entry.effect, subject: accessSubject(entry) });
    if (entry.effect === "write-files") {
      writers.add(command.name);
    }
    if (entry.whileReadOnly === "refuse") {
      guarded.add(command.name);
    }
  }

  async function invoke(name: string, input: unknown, ctx: InvokeContext): Promise<unknown> {
    const command = registry.get(name);
    if (command === undefined) {
      throw contracts.entry(name) === undefined
        ? new CommandError("input.invalid", `Unknown command: ${name}`, { command: name })
        : new CommandError("command.not-implemented", `Command ${name} is not implemented yet`, {
            command: name,
          });
    }
    let checked: unknown;
    try {
      // Defaults are filled into a copy; the caller's object stays as it was.
      checked = structuredClone(input);
    } catch (error) {
      throw new CommandError(
        "input.invalid",
        `Input of ${name} is not plain JSON data`,
        { command: name },
        {
          cause: error,
        },
      );
    }
    const validInput = contracts.validator(name, "input");
    if (!validInput(checked)) {
      const errors = inputViolations(validInput.errors, { input: checked, schemas: contracts.schemas });
      throw new CommandError(
        "input.invalid",
        `Invalid input for ${name}: ${describeInputViolations(errors)}`,
        {
          command: name,
          errors,
        },
      );
    }
    const signal = ctx.signal ?? new AbortController().signal;
    const { access } = ctx;
    const known = calls.get(name);
    const call: AccessCall | undefined =
      access !== undefined && FOLLOWED_ACCESSES.includes(access) && known !== undefined
        ? { ...known, access }
        : undefined;
    const confined = access !== undefined && !UNCONFINED_ACCESSES.includes(access);
    const localPaths = confined ? confinedLocalPaths(ctx.workspace, name) : OPEN_LOCAL_PATHS;
    let noted: Promise<NotedAccess | undefined> | undefined;
    let output: unknown;
    try {
      // Background work of the workspace (the search index) waits while the command runs.
      output = await ctx.workspace.runCommand(
        async () => {
          if (confined) {
            // Before anything else: a refused path is neither read nor written (SR-142 AK1).
            await localPaths.check(localPathUses(checked, pathFields.get(name)?.()));
          }
          if (guarded.has(name)) {
            await assertWritable(ctx.workspace, name);
          }
          // Before the command runs: a catalog the locator cannot follow fails before anything is written.
          const locator = locators.get(name)?.();
          const result = await command.run(
            { workspace: ctx.workspace, signal, localPaths },
            checked as never,
          );
          // Every problem that names an element names its short ID too (#315).
          const shown = await withElementShortIds(ctx.workspace, locator, result);
          if (call !== undefined) {
            // The states the command left, taken now; nothing waits for it (SR-117). Inputs and
            // outputs of catalog commands are objects (catalog.meta.schema.json).
            noted = noteAccess(
              ctx.workspace,
              call,
              checked as Readonly<Record<string, unknown>>,
              shown as Readonly<Record<string, unknown>>,
            );
          }
          return shown;
        },
        { writes: writers.has(name) },
      );
    } catch (error) {
      throw toCommandError(name, error, signal);
    }
    if (validateOutput) {
      const validOutput = contracts.validator(name, "output");
      if (!validOutput(output)) {
        const errors = schemaViolations(validOutput.errors);
        throw new CommandError(
          "internal",
          `Output of ${name} does not match its schema: ${describeViolations(errors)}`,
          {
            command: name,
            errors,
          },
        );
      }
    }
    if (noted !== undefined) {
      recordAccess(ctx.workspace, noted);
    }
    return output;
  }

  return { contracts, commands: registry, invoke };
}

// The runtime of this process. Immutable after creation (catalog, compiled schemas, implementations);
// it holds no workspace state, so this is not a global in the sense of ADR-0002 rule 7.
let processRuntime: CommandRuntime | undefined;

/**
 * Create the runtime of this process with these options and make `invoke` and `getCommandRuntime`
 * use it. Adapters configure it once at start, before the first call; replacing it later is for
 * tests only.
 */
export function configureCommandRuntime(options: CommandRuntimeOptions = {}): CommandRuntime {
  processRuntime = createCommandRuntime(options);
  return processRuntime;
}

/**
 * The runtime of this process (created with the defaults on first use). Adapters use it for the
 * catalog (`contracts.commands`, e.g. CLI subcommands, MCP tool list) and `commands` (implemented).
 */
export function getCommandRuntime(): CommandRuntime {
  processRuntime ??= createCommandRuntime();
  return processRuntime;
}

/**
 * Run a catalog command with the runtime of this process. Resolves with the command output or
 * rejects with a `CommandError` (never anything else once the catalog has loaded).
 */
export async function invoke(name: string, input: unknown, ctx: InvokeContext): Promise<unknown> {
  return getCommandRuntime().invoke(name, input, ctx);
}
