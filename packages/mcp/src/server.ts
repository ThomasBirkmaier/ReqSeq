// `logreq mcp` (ADR-0009): the MCP server over stdio, one tool per implemented catalog command. It has no
// network listener at all (SR-079). Every call is one `invoke`; the result is the command output as structured
// content and as JSON text, a CommandError is a tool error with the error object as JSON text (SR-080 AK2).
import type { CommandRuntime, Workspace } from "@logreq/core";
import {
  CommandError,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  agentInstructions,
  getCommandRuntime,
  jsonByteLength,
} from "@logreq/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { McpServer, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { ServerTool } from "./tools.js";
import { serverTools, toolName } from "./tools.js";
import type { InputStream, TextSink } from "./transport.js";
import { LineTransport, MAX_MESSAGE_BYTES } from "./transport.js";

export interface McpServerOptions {
  /** The workspace every call runs on; the caller closes it after the session. */
  readonly workspace: Workspace;
  /** Default: the runtime of this process (`getCommandRuntime()`). */
  readonly runtime?: CommandRuntime;
  /** Largest output also sent as JSON text; default `MAX_TEXT_BYTES` (tests take small ones). */
  readonly maxTextBytes?: number;
}

/**
 * Largest output whose JSON is also sent as text content: 32 MiB, the bound of an incoming message
 * (`MAX_MESSAGE_BYTES`). Above it the text is a note (`largeOutputNote`); `structuredContent` is the
 * output on every size (#277).
 */
export const MAX_TEXT_BYTES = MAX_MESSAGE_BYTES;

/** The text content of an output over `maxTextBytes` bytes of JSON. */
export const largeOutputNote = (maxTextBytes: number): string =>
  `The output is larger than ${String(maxTextBytes)} bytes of JSON, so it is only in structuredContent, not repeated as text. To get it as a file, call ${toolName("data.store")} with a folder.`;

/** A tool as `tools/list` sends it. */
const listed = (tool: ServerTool): Tool => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  // Every catalog input schema has `type: "object"` at its root (catalog.meta.schema.json), as MCP requires.
  inputSchema: tool.inputSchema as Tool["inputSchema"],
  annotations: { ...tool.annotations },
});

/** One tool call: the command output, or the CommandError as a tool error. Never rejects. */
export async function callTool(
  runtime: CommandRuntime,
  workspace: Workspace,
  command: string,
  args: unknown,
  signal: AbortSignal,
  maxTextBytes: number = MAX_TEXT_BYTES,
): Promise<CallToolResult> {
  try {
    const output = await runtime.invoke(command, args, { workspace, signal, access: "mcp" });
    // Catalog outputs are objects (catalog.meta.schema.json), checked in tests and debug builds.
    const structured = output as Record<string, unknown>;
    // Counted with an early stop, so a large output is never built as one string (#277).
    const text =
      jsonByteLength(output, maxTextBytes) <= maxTextBytes
        ? JSON.stringify(output)
        : largeOutputNote(maxTextBytes);
    return { content: [{ type: "text", text }], structuredContent: structured };
  } catch (error) {
    const object = (
      error instanceof CommandError ? error : new CommandError("internal", "Internal error in the MCP server")
    ).toJSON();
    // Text only: `structuredContent` is always the command output (its schema is in mcp-tools.json).
    return { isError: true, content: [{ type: "text", text: JSON.stringify(object) }] };
  }
}

/**
 * An MCP server that lists one tool per implemented catalog command, all calling `invoke` on
 * `options.workspace`, with the instructions of core in its `initialize` result. The tool handlers are set
 * on the protocol server directly, not with `registerTool` (which would make `McpServer` install its own,
 * and those answer every unregistered tool with a protocol error): a call to a catalog command that is not
 * listed (not implemented yet) must reach `invoke` and give `command.not-implemented`, as on every access
 * (SR-080 AK2). Input validation is core's alone.
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const runtime = options.runtime ?? getCommandRuntime();
  const list = serverTools(runtime).map(listed);
  const commands = new Map(runtime.contracts.commands.map((entry) => [toolName(entry.name), entry.name]));
  // No `tools` capability here: with it, McpServer installs its own tool handlers.
  const mcp = new McpServer(
    { name: PRODUCT_NAME.toLowerCase(), version: PRODUCT_VERSION },
    { capabilities: {}, instructions: agentInstructions(runtime, toolName) },
  );
  const server = mcp.server;
  server.registerCapabilities({ tools: { listChanged: false } });
  server.setRequestHandler("tools/list", () => ({ tools: list }));
  server.setRequestHandler("tools/call", async (request, ctx) => {
    const { name, arguments: args } = request.params;
    const command = commands.get(name);
    if (command === undefined) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Tool ${name} not found`);
    }
    const result = await callTool(
      runtime,
      options.workspace,
      command,
      args ?? {},
      ctx.mcpReq.signal,
      options.maxTextBytes,
    );
    // The era projection of the SDK, as McpServer does it. No output schema is advertised, and catalog outputs
    // are objects (catalog.meta.schema.json), so nothing is wrapped as `{ result }` (SR-080 AK2).
    return server.projectCallToolResult(result, undefined);
  });
  return mcp;
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
