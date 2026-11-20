// The one entry point of the adapters (CLI, API, MCP, app): `invoke(name, input, { workspace })`.
// Validates the input against the catalog, runs the command and maps every failure to a
// CommandError with a code from common.schema.json#/$defs/error (ADR-0002 rule 4). Adds the short
// ID of the element each problem of the output names (`withElementShortIds`, ThomasBirkmaier/ReqSeq-archive#315). Records the
// element of an API or MCP call as the last access of the copy (`recordAccess`, SR-117). Refuses the
// local paths of an API or MCP call outside the repositories of the workspace (SR-142). Gives each
// command `readOutputElements`, which runs another read command for `selection.output` (SR-224 AK5) the same way
// (`outputElementsReader`), and with `selection.output.count` gives the elements one number of its output counts
// (SR-224 AK4, output-count.ts). Leaves out the next steps of an output whose command it would refuse
// in the workspace of the call while it is read-only (`withRunnableSteps`, SR-226 AK6).
import path from "node:path";
import type {
  AnswerNames,
  AnyCommand,
  CommandContext,
  CommandErrorDetails,
  LocalPaths,
  OutputElements,
  OutputElementsReader,
} from "../catalog.js";
import { CommandError } from "../catalog.js";
import { commands as productCommands } from "../commands/index.js";
import type { NextStep } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { assertWritable, findType, metamodelState, runnableSteps } from "../metamodel/index.js";
import type { AccessCall, AccessName, NotedAccess } from "../model/activity.js";
import { FOLLOWED_ACCESSES, accessSubject, noteAccess, recordAccess } from "../model/activity.js";
import type { Contracts } from "./contracts.js";
import { SCHEMA_BASE, describeViolations, loadContracts, schemaViolations } from "./contracts.js";
import type { ProblemLocator } from "./element-short-ids.js";
import { problemLocator, withElementShortIds } from "./element-short-ids.js";
import type { InputViolation } from "./input-errors.js";
import { settledValue } from "./settled.js";
import { describeInputViolations, inputViolations } from "./input-errors.js";
import { internalError, learnWorkspaceRoots } from "./internal-cause.js";
import type { CatalogOutputField } from "./output-count.js";
import { checkedCount, countsAnswer } from "./output-count.js";
import type { LocalPathField } from "./local-path-fields.js";
import { localPathFields, localPathUses, replaceLocalPaths } from "./local-path-fields.js";
import { OPEN_LOCAL_PATHS, appLocalPaths, confinedLocalPaths } from "../workspace/local-paths.js";
import { expandHome } from "../workspace/path-text.js";
import type { Workspace } from "./workspace.js";

/** What an adapter passes per call. */
export interface InvokeContext {
  readonly workspace: Workspace;
  /** Abort when the caller goes away. Default: a signal that never aborts. */
  readonly signal?: AbortSignal;
  /**
   * The access the call comes through: each adapter passes its own name (ADR-0002 rule 4). It changes
   * the result in one way only, its local path rule: outside `UNCONFINED_ACCESSES` local paths must lie
   * inside the repositories of the workspace (SR-142, an exception to SR-080 AK2), and in the app `~` at
   * the start of a local path is the home folder (SR-143 AK2; the command line's shell expands it). Core records the element a successful call names as the last access of the
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

/**
 * The local path rule of an access of `UNCONFINED_ACCESSES` (or of none): the app's takes `~` for the home
 * folder, since its prompt has no shell that expands it (SR-143 AK2); the command line's shell does.
 */
const unconfinedLocalPaths = (access: AccessName | undefined): LocalPaths =>
  access === "app" ? appLocalPaths() : OPEN_LOCAL_PATHS;

/**
 * `input` with a leading `~` of its local path `fields` as `home` (the app), so the command reads and
 * writes where the completion of the app's prompt listed (`workspace.listFolder`); without a home as it is.
 */
const withHome = (
  input: unknown,
  fields: readonly LocalPathField[] | undefined,
  home: string | undefined,
): unknown =>
  home === undefined ? input : replaceLocalPaths(input, fields, (value) => expandHome(value, home));

/**
 * The names of an answer from the metamodel the command left (`AnswerNames`). Nothing is read: a
 * command whose answer names a type has read the metamodel in `run`. Only a type the metamodel does
 * not have, or a metamodel that is not built or failed (reset by a watcher meanwhile, or a command
 * that does not read it), names a type by its key, so a successful command never fails for its answer.
 */
const answerNames = (metamodel: Metamodel | undefined): AnswerNames => ({
  type: (key) => (metamodel === undefined ? undefined : findType(metamodel, key)?.name) ?? key,
});

/**
 * How `readOutputElements` gets the elements of `name` (ADR-0002 rule 4): the answer, or the number
 * `counted` names (`runtime/output-count.ts`). Every product command with such a field has the hook it
 * needs (commands/registry.test.ts); a command without it is a bug, `internal`.
 */
const elementsOf = (
  name: string,
  command: AnyCommand,
  fields: readonly CatalogOutputField[],
  counted: ReturnType<typeof checkedCount> | undefined,
): ((ctx: CommandContext, input: never) => Promise<OutputElements>) => {
  const { outputElements, countedElements } = command;
  if (counted === undefined || countsAnswer(counted.field, fields)) {
    if (outputElements === undefined) {
      throw new Error(
        `command ${name} has an output field marked x-elements "answer", but no outputElements`,
      );
    }
    return outputElements;
  }
  if (countedElements === undefined) {
    throw new Error(
      `command ${name} has an output field marked x-elements ${JSON.stringify(counted.elements)}, but no countedElements`,
    );
  }
  return (ctx, input) => countedElements(ctx, input, counted.count);
};

/**
 * `output` with the answer of `command` first (SR-224 AK1), or as it is for a command without
 * one (a command of a test-only catalog, `CommandDefinition.answer`). Outputs of catalog commands are
 * objects (catalog.meta.schema.json).
 */
const answered = async (
  command: AnyCommand,
  output: unknown,
  input: unknown,
  workspace: Workspace,
): Promise<unknown> =>
  command.answer === undefined
    ? output
    : {
        answer: command.answer(
          output,
          input as never,
          answerNames(await settledValue(workspace.peek(metamodelState)).catch(() => undefined)),
        ),
        ...(output as Readonly<Record<string, unknown>>),
      };

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
 * Any failure that is not a CommandError becomes `internal`, with `details.cause` naming the original
 * error: its name, its Node code and the first line of its message without absolute paths
 * (`internalCause`, #1794). The whole error, its stack included, stays only in `cause`.
 * An abort (the signal fired, or an `AbortError`) is `internal` too, with `details.aborted` and no
 * cause; the caller has gone away, so nobody acts on the code (ADR-0009).
 */
const toCommandError = (
  name: string,
  error: unknown,
  signal: AbortSignal,
  workspace: Workspace,
): CommandError => {
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
  return internalError(`Internal error in ${name}`, error, { workspace, command: name });
};

/** The most `selection.output` selections inside each other (#1873): deeper is `input.invalid`. */
export const MAX_OUTPUT_DEPTH = 4;

/** Where the input of `selection.output` is, as messages and `details` name fields. */
const INNER = "selection.output.input";

/** `field` of the inner command's input as a field of the outer one. */
const innerField = (field: string): string => (field === "" ? INNER : `${INNER}.${field}`);

/** The violations and fields an inner error may name in its `details`. */
interface NamedDetails {
  readonly command?: string;
  readonly fields?: readonly string[];
  readonly errors?: readonly InputViolation[];
}

/**
 * An error of the inner command of `selection.output` with its fields named under `selection.output.input`, in
 * `details` and in the message; the code stays (#1873).
 */
const innerError = (error: CommandError): CommandError => {
  const details = error.details as (CommandErrorDetails & NamedDetails) | undefined;
  const errors = details?.errors?.map((violation): InputViolation => ({
    ...violation,
    field: innerField(violation.field),
    path: `/selection/output/input${violation.path}`,
    message:
      violation.field === ""
        ? violation.message.replace(/^The input /, `${INNER} `)
        : `${INNER}.${violation.message}`,
  }));
  const fields = details?.fields?.map(innerField);
  const message =
    errors !== undefined
      ? `Invalid input for ${String(details?.command)}: ${describeInputViolations(errors)}`
      : details?.fields?.some((field) => error.message.startsWith(`${field}:`)) === true
        ? `${INNER}.${error.message}`
        : `${INNER}: ${error.message}`;
  return new CommandError(
    error.code,
    message,
    details === undefined
      ? undefined
      : {
          ...details,
          ...(fields === undefined ? {} : { fields }),
          ...(errors === undefined ? {} : { errors }),
        },
    { cause: error },
  );
};

/**
 * Whether an output schema requires the field `next`, a list of next steps (`common.schema.json#/$defs/nextStep`):
 * only then is `next` of an output read.
 */
const hasNextSteps = (output: unknown): boolean => {
  const schema = output as { required?: unknown; properties?: { next?: { items?: { $ref?: unknown } } } };
  const ref = schema.properties?.next?.items?.$ref;
  return (
    typeof ref === "string" &&
    ref.endsWith("#/$defs/nextStep") &&
    Array.isArray(schema.required) &&
    schema.required.includes("next")
  );
};

/**
 * `result` with only the next steps of its `next` that can run now (SR-226 AK6): a step in the workspace of
 * the call is left out when `refused` names its command and the workspace is read-only; a step in another
 * workspace (the new one of `workspace.init`) is the command's to check.
 */
const withRunnableSteps = async (
  workspace: Workspace,
  result: unknown,
  refused: (command: string) => boolean,
): Promise<unknown> => {
  // `hasNextSteps`: the output has `next`.
  const steps = (result as { readonly next: readonly NextStep[] }).next;
  const here = (step: NextStep): boolean =>
    step.workspace === undefined || path.resolve(step.workspace) === path.resolve(workspace.root);
  const local = steps.filter(here);
  if (local.length === 0) {
    // No step runs here: the workspace of the call is not read (`workspace.init` in another folder).
    return result;
  }
  const runnable = new Set(await runnableSteps(workspace, local, refused));
  const left = new Set(local.filter((step) => !runnable.has(step)));
  return { ...(result as object), next: steps.filter((step) => !left.has(step)) };
};

/** `input.invalid` of `command` at `field` of `selection.output`. */
const outputInvalid = (command: string, field: string, message: string): CommandError =>
  new CommandError("input.invalid", `${field}: ${message}`, { command, fields: [field] });

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
  // Commands whose output names next steps in `next` (SR-226).
  const stepping = new Set<string>();
  // Where the output of each command holds problems, from its output schema (ThomasBirkmaier/ReqSeq-archive#315); built on the
  // first call of the command, since a CLI process runs one (ThomasBirkmaier/ReqSeq-archive#319).
  const locators = new Map<string, () => ProblemLocator | undefined>();
  // Which element a call of each command names, from its catalog entry (SR-117).
  const calls = new Map<string, Omit<AccessCall, "access">>();
  // The local path fields of each command's input (SR-142), built at once, so a catalog whose local
  // paths cannot all be found fails here and not on the first API or MCP call.
  const pathFields = new Map<string, readonly LocalPathField[]>();
  for (const command of options.commands ?? productCommands) {
    const entry = contracts.entry(command.name);
    if (entry === undefined) {
      throw new Error(
        `command ${command.name} has no entry in the catalog, schemas/commands/${command.name}.json`,
      );
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
    pathFields.set(
      command.name,
      localPathFields(entry.input, `${SCHEMA_BASE}commands/${command.name}.input.json`, contracts.schemas),
    );
    calls.set(command.name, { command: command.name, effect: entry.effect, subject: accessSubject(entry) });
    if (entry.effect === "write-files") {
      writers.add(command.name);
    }
    if (entry.whileReadOnly === "refuse") {
      guarded.add(command.name);
    }
    if (hasNextSteps(entry.output)) {
      stepping.add(command.name);
    }
  }

  /** A copy of `input` checked against the input schema of `name`, with its defaults, else `input.invalid`. */
  const checkedInput = (name: string, input: unknown): unknown => {
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
    return checked;
  };

  /**
   * The local path rule of the access of `ctx` for `name` (SR-142, SR-143): `checked` with a leading `~` of its
   * local path fields as the home folder in the app, and the check a confined access makes of them before the
   * command runs (SR-142 AK1), for a call and for the inner call of `selection.output` alike.
   */
  const pathRuleOf = (
    ctx: InvokeContext,
    name: string,
    checked: unknown,
  ): {
    readonly localPaths: LocalPaths;
    readonly input: unknown;
    readonly checkPaths: () => Promise<void>;
  } => {
    const { access } = ctx;
    const confined = access !== undefined && !UNCONFINED_ACCESSES.includes(access);
    const localPaths = confined ? confinedLocalPaths(ctx.workspace, name) : unconfinedLocalPaths(access);
    const fields = pathFields.get(name);
    const input = withHome(checked, fields, localPaths.home);
    return {
      localPaths,
      input,
      checkPaths: () => (confined ? localPaths.check(localPathUses(input, fields)) : Promise.resolve()),
    };
  };

  /**
   * `readOutputElements` of a call at `depth` (0 for the call itself): the output elements of a read command, run as `invoke`
   * runs it inside this call: the same input check, the local path rule of the call's access (`~` as home
   * in the app, confined paths checked first through the API and MCP), the call's signal, no recorded access.
   */
  const outputElementsReader =
    (ctx: InvokeContext, signal: AbortSignal, caller: string, depth: number): OutputElementsReader =>
    async (name, input, asked): Promise<OutputElements> => {
      if (depth >= MAX_OUTPUT_DEPTH) {
        throw outputInvalid(
          caller,
          "selection.output",
          `at most ${String(MAX_OUTPUT_DEPTH)} output selections may be nested in each other`,
        );
      }
      const entry = contracts.entry(name);
      const command = registry.get(name);
      if (entry === undefined) {
        throw outputInvalid(
          caller,
          "selection.output.command",
          `${JSON.stringify(name)} is no command of the catalog`,
        );
      }
      if (entry.effect !== "read") {
        throw outputInvalid(
          caller,
          "selection.output.command",
          `${name} writes files; selection.output runs read commands only`,
        );
      }
      const fields = entry.outputFields ?? [];
      // A number of the output (SR-224 AK4), else its answer (AK5).
      const counted = asked === undefined ? undefined : checkedCount(caller, name, fields, asked);
      if (counted === undefined && !fields.some((field) => field.elements === "answer")) {
        throw outputInvalid(
          caller,
          "selection.output.command",
          `${name} lists no elements (no output field is marked x-elements "answer")`,
        );
      }
      if (command === undefined) {
        throw new CommandError("command.not-implemented", `Command ${name} is not implemented yet`, {
          command: name,
        });
      }
      const resolve = elementsOf(name, command, fields, counted);
      signal.throwIfAborted();
      try {
        const rule = pathRuleOf(ctx, name, checkedInput(name, input));
        await rule.checkPaths();
        const inner = {
          workspace: ctx.workspace,
          signal,
          localPaths: rule.localPaths,
          readOutputElements: outputElementsReader(ctx, signal, name, depth + 1),
        };
        return await resolve(inner, rule.input as never);
      } catch (error) {
        throw error instanceof CommandError ? innerError(error) : error;
      }
    };

  async function invoke(name: string, input: unknown, ctx: InvokeContext): Promise<unknown> {
    const command = registry.get(name);
    if (command === undefined) {
      throw contracts.entry(name) === undefined
        ? new CommandError("input.invalid", `Unknown command: ${name}`, { command: name })
        : new CommandError("command.not-implemented", `Command ${name} is not implemented yet`, {
            command: name,
          });
    }
    const rule = pathRuleOf(ctx, name, checkedInput(name, input));
    const checked = rule.input;
    const { localPaths } = rule;
    const signal = ctx.signal ?? new AbortController().signal;
    const { access } = ctx;
    const known = calls.get(name);
    const call: AccessCall | undefined =
      access !== undefined && FOLLOWED_ACCESSES.includes(access) && known !== undefined
        ? { ...known, access }
        : undefined;
    let noted: Promise<NotedAccess | undefined> | undefined;
    let output: unknown;
    try {
      // Background work of the workspace (the search index) waits while the command runs.
      output = await ctx.workspace.runCommand(
        async () => {
          // Read now, so that an internal error can name the root in its real form too (#1794).
          await learnWorkspaceRoots(ctx.workspace);
          // Before anything else: a refused path is neither read nor written (SR-142 AK1).
          await rule.checkPaths();
          if (guarded.has(name)) {
            await assertWritable(ctx.workspace, name);
          }
          // Before the command runs: a catalog the locator cannot follow fails before anything is written.
          const locator = locators.get(name)?.();
          const ran = await command.run(
            {
              workspace: ctx.workspace,
              signal,
              localPaths,
              readOutputElements: outputElementsReader(ctx, signal, name, 0),
            },
            checked as never,
          );
          const result = stepping.has(name)
            ? await withRunnableSteps(ctx.workspace, ran, (step) => guarded.has(step))
            : ran;
          // Every problem that names an element names its short ID too (ThomasBirkmaier/ReqSeq-archive#315),
          // and the output starts with its answer, built in core for every access (SR-224 AK1).
          const shown = await answered(
            command,
            await withElementShortIds(ctx.workspace, locator, result),
            checked,
            ctx.workspace,
          );
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
      throw toCommandError(name, error, signal, ctx.workspace);
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
 * rejects with a `CommandError`; a plain `Error` only for a programming error, such as a schema that
 * does not compile when its validator is built on the first call of the command (#178).
 */
export async function invoke(name: string, input: unknown, ctx: InvokeContext): Promise<unknown> {
  return getCommandRuntime().invoke(name, input, ctx);
}
