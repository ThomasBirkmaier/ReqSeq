// `logreq mcp` (ADR-0009): the MCP server over stdio, one tool per catalog command. It has no network
// listener at all (SR-079). Every call is one `invoke`; the result is the command output as structured
// content and as JSON text, a CommandError is a tool error with the error object as JSON text (SR-080 AK2).
import type { CommandRuntime, JsonSchema, Workspace } from "@logreq/core";
import { CommandError, PRODUCT_NAME, PRODUCT_VERSION, getCommandRuntime } from "@logreq/core";
import type { CallToolResult, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { serverTools } from "./tools.js";
import type { InputStream, TextSink } from "./transport.js";
import { LineTransport } from "./transport.js";

export interface McpServerOptions {
  /** The workspace every call runs on; the caller closes it after the session. */
  readonly workspace: Workspace;
  /** Default: the runtime of this process (`getCommandRuntime()`). */
  readonly runtime?: CommandRuntime;
}

/**
 * A JSON Schema of the catalog in the form the SDK takes (Standard Schema with JSON Schema). Its `validate`
 * accepts everything: core validates the input, so a wrong input is the same `input.invalid` on every access.
 */
const catalogSchema = (schema: JsonSchema): StandardSchemaWithJSON => ({
  "~standard": {
    version: 1,
    vendor: "logreq",
    validate: (value: unknown) => ({ value }),
    jsonSchema: { input: () => ({ ...schema }), output: () => ({ ...schema }) },
  },
});

/** One tool call: the command output, or the CommandError as a tool error. Never rejects. */
export async function callTool(
  runtime: CommandRuntime,
  workspace: Workspace,
  command: string,
  args: unknown,
  signal: AbortSignal,
): Promise<CallToolResult> {
  try {
    const output = await runtime.invoke(command, args, { workspace, signal });
    // Catalog outputs are objects (catalog.meta.schema.json), checked in tests and debug builds.
    const structured = output as Record<string, unknown>;
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: structured };
  } catch (error) {
    const object = (
      error instanceof CommandError ? error : new CommandError("internal", "Internal error in the MCP server")
    ).toJSON();
    // Text only: `structuredContent` must match the tool's output schema, and the error object does not.
    return { isError: true, content: [{ type: "text", text: JSON.stringify(object) }] };
  }
}

/** An MCP server with one tool per catalog command, all calling `invoke` on `options.workspace`. */
export function createMcpServer(options: McpServerOptions): McpServer {
  const runtime = options.runtime ?? getCommandRuntime();
  const server = new McpServer(
    { name: PRODUCT_NAME.toLowerCase(), version: PRODUCT_VERSION },
    { capabilities: { tools: {} } },
  );
  for (const tool of serverTools(runtime)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: catalogSchema(tool.inputSchema),
        outputSchema: catalogSchema(tool.outputSchema),
        annotations: { ...tool.annotations },
      },
      (args: unknown, ctx) => callTool(runtime, options.workspace, tool.command, args, ctx.mcpReq.signal),
    );
  }
  return server;
}

export interface ServeMcpOptions extends McpServerOptions {
  /** Messages from the client, one JSON-RPC message per line (standard input). */
  readonly input: InputStream;
  /** Messages to the client (standard output); nothing else may be written there. */
  readonly output: TextSink;
  /** Ends the session (Ctrl-C, SIGTERM). */
  readonly signal?: AbortSignal;
}

/**
 * Serve MCP over the stdio framing until the input ends or `signal` aborts; resolves when the session is
 * closed. The SDK picks the protocol era from the client's first message.
 */
export async function serveMcp(options: ServeMcpOptions): Promise<void> {
  const transport = new LineTransport(options.input, options.output);
  const handle = serveStdio(() => createMcpServer(options), { transport });
  const stop = (): void => {
    void handle.close();
  };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted === true) {
    stop();
  }
  await transport.closed;
  options.signal?.removeEventListener("abort", stop);
  await handle.close();
}
