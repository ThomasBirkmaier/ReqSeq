// The command catalog is the only place where LogReq has program logic (ADR-0002).
// CLI, API, MCP server and app are generated adapters over these definitions.

/** JSON Schema (2020-12) as plain object. The schema files in schemas/commands/ are the source. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Whether a command only reads or also writes files in the working tree. Never Git (D-036). */
export type CommandEffect = "read" | "write-files";

export interface CommandDefinition<In, Out> {
  /** Stable dotted name, e.g. `element.create`. Used as CLI subcommand, API path and MCP tool name. */
  readonly name: string;
  readonly summary: string;
  readonly effect: CommandEffect;
  /** System requirements this command implements; checked by trace-check. */
  readonly implements: readonly string[];
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  readonly run: (ctx: CommandContext, input: In) => Promise<Out>;
}

/** Everything a command may touch. Adapters create one context per workspace. */
export interface CommandContext {
  readonly workspaceRoot: string;
  /** Aborted when the caller goes away (closed window, cancelled request). */
  readonly signal: AbortSignal;
}

/** Problems are data, not exceptions: commands return them so every access shows the same result (SR-080). */
export interface Problem {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly file?: string;
  readonly elementId?: string;
}

export class CommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

export const defineCommand = <In, Out>(def: CommandDefinition<In, Out>): CommandDefinition<In, Out> => def;
