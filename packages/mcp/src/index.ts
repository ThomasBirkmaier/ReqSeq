// The MCP server (ADR-0009): an adapter over the command catalog of @logreq/core (ADR-0002), stdio only.
export { callTool, createMcpServer, serveMcp } from "./server.js";
export type { McpServerOptions, ServeMcpOptions } from "./server.js";
export { catalogTools, serverTools, toolName } from "./tools.js";
export type { McpTool, McpToolAnnotations, McpToolList, ServerTool } from "./tools.js";
export { LineTransport, MAX_MESSAGE_BYTES } from "./transport.js";
export type { InputStream, TextSink } from "./transport.js";
