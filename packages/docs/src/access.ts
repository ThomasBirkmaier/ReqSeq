// How a command is called in each access (SR-139 AK1), taken from the adapters themselves: the CLI's own
// `--help`, the API path and the MCP tool of the generated contracts.
import { Readable } from "node:stream";
import { COMMANDS_PATH } from "@reqseq/api";
import { argvFor, runCli } from "@reqseq/cli";
import type { CatalogEntry, CommandRuntime } from "@reqseq/core";
import { toolName } from "@reqseq/mcp";

/** The parts of `schemas/generated/openapi.json` and `mcp-tools.json` the pages read. */
export interface GeneratedContracts {
  readonly openapi: { readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>> };
  readonly mcpTools: {
    readonly tools: readonly {
      readonly name: string;
      readonly inputSchema?: { readonly properties?: Readonly<Record<string, unknown>> };
    }[];
  };
}

export interface CommandAccess {
  /** False while this version does not implement the command (the MCP server does not offer it). */
  readonly implemented: boolean;
  /** `reqseq <group> <action>`, and the exact text of its `--help`. */
  readonly cliCall: string;
  readonly cliHelp: string;
  readonly apiCall: string;
  readonly mcpTool: string;
}

/** The text `reqseq <args>` prints, run in this process with `runtime` (its catalog). */
export async function cliOutput(args: readonly string[], runtime: CommandRuntime): Promise<string> {
  let text = "";
  const sink = {
    write: (chunk: string): boolean => {
      text += chunk;
      return true;
    },
  };
  await runCli({
    argv: args,
    cwd: process.cwd(),
    stdin: Readable.from([]),
    stdout: sink,
    stderr: sink,
    runtime,
  });
  return text;
}

/** How `entry` is called in the CLI, the API and MCP. Fails when a generated contract lacks it. */
export async function commandAccess(
  entry: CatalogEntry,
  runtime: CommandRuntime,
  generated: GeneratedContracts,
): Promise<CommandAccess> {
  const path = `${COMMANDS_PATH}/${entry.name}`;
  const methods = Object.keys(generated.openapi.paths[path] ?? {});
  const tool = toolName(entry.name);
  if (methods.length === 0 || !generated.mcpTools.tools.some((candidate) => candidate.name === tool)) {
    throw new Error(`${entry.name} is missing in the generated contracts: run pnpm contracts:generate`);
  }
  const args = argvFor(entry, {}, runtime.contracts.schemas);
  return {
    implemented: runtime.commands.has(entry.name),
    cliCall: ["reqseq", ...args].join(" "),
    cliHelp: await cliOutput([...args, "--help"], runtime),
    apiCall: `${methods.map((method) => method.toUpperCase()).join(", ")} ${path}`,
    mcpTool: tool,
  };
}
