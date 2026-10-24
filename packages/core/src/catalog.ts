// The command catalog is the only place where LogReq has program logic (ADR-0002).
// CLI, API, MCP server and app are generic adapters that call `invoke` (runtime/invoke.ts).
// See packages/core/README.md for how a command is written and registered.
import type { Workspace } from "./runtime/workspace.js";

/** JSON Schema (2020-12) as plain object. The schema files in schemas/ are the source. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Whether a command only reads or also writes files in the working tree. Never Git (D-036). */
export type CommandEffect = "read" | "write-files";

/**
 * Implementation of one catalog entry. Only the name and `run` live here; summary, effect, stage,
 * `implements` and the input and output schemas come from `schemas/commands/catalog.json`, so they
 * cannot drift from the contract.
 */
export interface CommandDefinition<In, Out> {
  /** Name of the catalog entry, `group.action`; the file is `commands/<group>/<action>.ts`. */
  readonly name: string;
  /** Gets input that already passed the catalog input schema, with defaults applied. */
  readonly run: (ctx: CommandContext, input: In) => Promise<Out>;
}

/** Any command, whatever its input and output types (what the registry stores). */
export type AnyCommand = CommandDefinition<never, unknown>;

/** Everything a command may touch. `invoke` creates one per call. */
export interface CommandContext {
  /** State of the workspace the call is for (metamodel, elements, caches); one object per root. */
  readonly workspace: Workspace;
  /** Aborted when the caller goes away (closed window, cancelled request). */
  readonly signal: AbortSignal;
}

/** Problems are data, not exceptions: commands return them so every access shows the same result (SR-080). */
export interface Problem {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly file?: string;
  /** Line in `file`, from 1. */
  readonly line?: number;
  readonly elementId?: string;
}

/**
 * Codes of `common.schema.json#/$defs/error`, in schema order. A test fails when this list and the
 * schema differ: add a code to the schema and here in the same PR.
 * Hand-written until the types are generated from the schemas (ADR-0003, #134).
 */
export const COMMAND_ERROR_CODES = [
  "input.invalid",
  "ref.unknown",
  "ref.ambiguous",
  "workspace.not-found",
  "workspace.read-only",
  "element.read-only",
  "element.not-found",
  "metamodel.meaning-unassigned",
  "relation.not-allowed",
  "variant.nested",
  "baseline.uncommitted-changes",
  "reqif.invalid",
  "reqif.unmapped",
  "git.unavailable",
  "file.changed-on-disk",
  "file.faulty",
  "file.read-only",
  "file.not-regular",
  "file.folder-missing",
  "internal",
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/** Machine-readable details of an error, e.g. the failed schema checks of `input.invalid`. */
export type CommandErrorDetails = Readonly<Record<string, unknown>>;

/**
 * `common.schema.json#/$defs/error`: what every adapter sends for a failed call.
 * Hand-written until the types are generated from the schemas (ADR-0003, #134).
 */
export interface CommandErrorObject {
  readonly code: CommandErrorCode;
  readonly message: string;
  readonly details?: CommandErrorDetails;
}

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

/** Define a command implementation; the file default-exports the result (see commands/index.ts). */
export const defineCommand = <In, Out>(def: CommandDefinition<In, Out>): CommandDefinition<In, Out> => def;
