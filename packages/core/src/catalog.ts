// The command catalog is the only place where ReqSeq has program logic (ADR-0002).
// CLI, API, MCP server and app are generic adapters that call `invoke` (runtime/invoke.ts).
// See packages/core/README.md for how a command is written and registered.
import type { CommandCatalog, CommandErrorObject, CommandTypes, Problem } from "./generated/types.js";
import type { Workspace } from "./runtime/workspace.js";

// Types of the schemas are generated (generated/types.ts, `pnpm contracts:generate`, ADR-0003).
export type { CommandErrorObject, Problem };

/** JSON Schema (2020-12) as plain object. The schema files in schemas/ are the source. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Whether a command only reads or also writes files in the working tree. Never Git (D-036). */
export type CommandEffect = CommandCatalog["commands"][number]["effect"];

/** Name of a catalog command, `group.action`. */
export type CommandName = keyof CommandTypes;

/** Input of a catalog command as `run` gets it: validated, with `default` values filled in. */
export type CommandInput<N extends CommandName> = CommandTypes[N]["input"];

/** Output of a catalog command, checked against the catalog in tests and debug builds. */
export type CommandOutput<N extends CommandName> = CommandTypes[N]["output"];

/** Code of a command error (`common.schema.json#/$defs/error`). */
export type CommandErrorCode = CommandErrorObject["code"];

/** Machine-readable details of an error, e.g. the failed schema checks of `input.invalid`. */
export type CommandErrorDetails = NonNullable<CommandErrorObject["details"]>;

/**
 * Implementation of one command. Only the name and `run` live here; summary, effect, stage,
 * `implements` and the input and output schemas come from `schemas/commands/catalog.json`, so they
 * cannot drift from the contract. Product commands use `defineCommand`, which types `In` and `Out`
 * from the catalog; tests with test-only catalogs write the types themselves.
 */
export interface CommandDefinition<In, Out> {
  /** Name of the catalog entry, `group.action`; the file is `commands/<group>/<action>.ts`. */
  readonly name: string;
  /** Gets input that already passed the catalog input schema, with defaults applied. */
  readonly run: (ctx: CommandContext, input: In) => Promise<Out>;
}

/** Implementation of the catalog command `N`, typed from its catalog schemas. */
export interface CatalogCommand<N extends CommandName> extends CommandDefinition<
  CommandInput<N>,
  CommandOutput<N>
> {
  readonly name: N;
}

/** Any command, whatever its input and output types (what the registry stores). */
export type AnyCommand = CommandDefinition<never, unknown>;

/** Everything a command may touch. `invoke` creates one per call. */
export interface CommandContext {
  /** State of the workspace the call is for (metamodel, elements, caches); one object per root. */
  readonly workspace: Workspace;
  /** Aborted when the caller goes away (closed window, cancelled request). */
  readonly signal: AbortSignal;
  /**
   * The local path rule of the call's access (SR-142). `invoke` checks the `localPath` fields of the
   * input itself; a command passes every further path it takes from file content (an image a ReqIF
   * file names, the target of a mapping) through `check` before it reads or writes there.
   */
  readonly localPaths: LocalPaths;
}

/** A local path and the input field (or file content) it comes from, as `LocalPaths.check` names it. */
export interface LocalPathUse {
  /** The input name (`file`, `changedFiles[1]`), or what a derived path comes from. */
  readonly field: string;
  /** Absolute, or relative to the workspace root. */
  readonly path: string;
}

/**
 * Through the command line and the app every local path is accepted; through any other access (API,
 * MCP server) only one inside the repositories of the workspace (SR-142, ADR-0009). `check` rejects
 * with `input.invalid` naming every refused path, before anything is read or written there.
 */
export interface LocalPaths {
  check(uses: readonly LocalPathUse[]): Promise<void>;
}

/**
 * What kind of failure a code is, so every adapter maps codes with one table (ADR-0009 "Errors"):
 * - `input`: the request itself is wrong (fix the input and retry).
 * - `not-found`: something the request names does not exist (element, workspace, folder).
 * - `conflict`: the request is fine, but the state of the workspace or a file refuses it.
 * - `unavailable`: a tool ReqSeq needs is missing on this machine (Git).
 * - `not-implemented`: the command is in the catalog, but this version does not implement it yet (#303).
 * - `internal`: a bug in ReqSeq, or a call aborted by its caller (`details.aborted`).
 *
 * CLI: `internal` is exit code 3, every other class exit code 2 (#124). API and MCP: #125.
 */
export type CommandErrorClass =
  "input" | "not-found" | "conflict" | "unavailable" | "not-implemented" | "internal";

/** The class of every code; the `Record` type makes a new code of the schema fail to compile until it is classified. */
export const COMMAND_ERROR_CLASSES: Readonly<Record<CommandErrorCode, CommandErrorClass>> = {
  "input.invalid": "input",
  "ref.unknown": "not-found",
  "ref.ambiguous": "input",
  "workspace.not-found": "not-found",
  "workspace.read-only": "conflict",
  "element.read-only": "conflict",
  "element.not-found": "not-found",
  "metamodel.meaning-unassigned": "conflict",
  "relation.not-allowed": "input",
  "variant.nested": "input",
  "baseline.uncommitted-changes": "conflict",
  "baseline.exists": "conflict",
  "reqif.invalid": "input",
  "reqif.unmapped": "input",
  "git.unavailable": "unavailable",
  "git.commit-not-found": "not-found",
  "file.changed-on-disk": "conflict",
  "file.faulty": "conflict",
  "file.read-only": "conflict",
  "file.not-regular": "conflict",
  "file.folder-missing": "not-found",
  "command.not-implemented": "not-implemented",
  internal: "internal",
};

/** The class of an error code (COMMAND_ERROR_CLASSES). */
export const errorClass = (code: CommandErrorCode): CommandErrorClass => COMMAND_ERROR_CLASSES[code];

/**
 * A real error of a command call (not a finding: findings are returned as `problems`).
 * Every adapter maps `code` the same way (ADR-0002 rule 4, ADR-0009).
 */
export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly details: CommandErrorDetails | undefined;

  constructor(
    code: CommandErrorCode,
    message: string,
    details?: CommandErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }

  /** The error object as the schema defines it; `cause` and the stack stay internal. */
  toJSON(): CommandErrorObject {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * `error` when it is a `CommandError`, for a command that turns a refusal into a problem and goes
 * on; any other error is a bug and is thrown again.
 */
export const commandErrorOrThrow = (error: unknown): CommandError => {
  if (error instanceof CommandError) {
    return error;
  }
  throw error;
};

/**
 * Define the implementation of a catalog command; the file default-exports the result (see
 * commands/index.ts). The name picks the catalog entry, which types `input` and the result of `run`:
 * `defineCommand({ name: "workspace.status", run: async (ctx, input) => ... })`.
 */
export const defineCommand = <N extends CommandName>(def: CatalogCommand<N>): CatalogCommand<N> => def;

/**
 * Define a command for a test-only catalog (`loadContracts({ catalog })`), whose names are not in the
 * generated `CommandTypes`: input and output types are given, `ctx` is typed as for `defineCommand`.
 * `defineTestCommand<EchoInput, EchoOutput>({ name: "test.echo", run: async (ctx, input) => ... })`.
 * For tests only; product commands use `defineCommand`.
 */
export const defineTestCommand = <In, Out>(def: CommandDefinition<In, Out>): CommandDefinition<In, Out> =>
  def;
