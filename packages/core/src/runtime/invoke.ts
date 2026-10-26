// The one entry point of the adapters (CLI, API, MCP, app): `invoke(name, input, { workspace })`.
// Validates the input against the catalog, runs the command and maps every failure to a
// CommandError with a code from common.schema.json#/$defs/error (ADR-0002 rule 4). Adds the short
// ID of the element each problem of the output names (`withElementShortIds`, #315).
import type { AnyCommand } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { commands as productCommands } from "../commands/index.js";
import { assertWritable } from "../metamodel/index.js";
import type { Contracts } from "./contracts.js";
import { SCHEMA_BASE, describeViolations, loadContracts, schemaViolations } from "./contracts.js";
import type { ProblemLocator } from "./element-short-ids.js";
import { problemLocator, withElementShortIds } from "./element-short-ids.js";
import { describeInputViolations, inputViolations } from "./input-errors.js";
import type { Workspace } from "./workspace.js";

/** What an adapter passes per call. */
export interface InvokeContext {
  readonly workspace: Workspace;
  /** Abort when the caller goes away. Default: a signal that never aborts. */
  readonly signal?: AbortSignal;
}

export interface CommandRuntimeOptions {
  /** Implementations to register. Default: all product commands (commands/index.ts). */
  readonly commands?: readonly AnyCommand[];
  /** Default: `loadContracts()` with the schemas of this repository. */
  readonly contracts?: Contracts;
  /**
   * Check every output against the catalog output schema; a mismatch is an `internal` error.
   * Default: on when the environment has `LOGREQ_VALIDATE_OUTPUT=1` (tests and debug builds).
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
 * Write commands that run without an open workspace: `workspace.init` creates one, so there is no
 * metamodel yet that could make it read-only. Interim list: the exemption belongs to the catalog
 * entry (ADR-0002 rule 5), and #142 replaces this list with a catalog field.
 */
const CREATES_WORKSPACE: ReadonlySet<string> = new Set(["workspace.init"]);

/**
 * Bind implementations to their catalog entries. Holds compiled schemas only, never workspace
 * state, so one runtime serves any number of workspaces. Throws a plain `Error` when an
 * implementation has no catalog entry or a name is registered twice (programming errors).
 */
export function createCommandRuntime(options: CommandRuntimeOptions = {}): CommandRuntime {
  const contracts = options.contracts ?? loadContracts();
  const validateOutput = options.validateOutput ?? process.env["LOGREQ_VALIDATE_OUTPUT"] === "1";
  const registry = new Map<string, AnyCommand>();
  // Write commands that are refused while the workspace is read-only (SR-011 AK3).
  const guarded = new Set<string>();
  // Where the output of each command holds problems, from its output schema (#315); built on the
  // first call of the command, since a CLI process runs one (#319).
  const locators = new Map<string, () => ProblemLocator | undefined>();
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
    if (entry.effect === "write-files" && !CREATES_WORKSPACE.has(command.name)) {
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
    let output: unknown;
    try {
      // Background work of the workspace (the search index) waits while the command runs.
      output = await ctx.workspace.runCommand(async () => {
        if (guarded.has(name)) {
          await assertWritable(ctx.workspace, name);
        }
        // Before the command runs: a catalog the locator cannot follow fails before anything is written.
        const locator = locators.get(name)?.();
        const result = await command.run({ workspace: ctx.workspace, signal }, checked as never);
        // Every problem that names an element names its short ID too (#315).
        return withElementShortIds(ctx.workspace, locator, result);
      });
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
