# @logreq/mcp

The MCP server of LogReq (ADR-0009) for AI agents: stdio only, one tool per command of the catalog of `@logreq/core` (ADR-0002). It has no logic of its own; every tool call is one `invoke` call. Started by `logreq mcp`.

```json
{ "mcpServers": { "logreq": { "command": "logreq", "args": ["mcp", "--workspace", "/path/to/copy"] } } }
```

- Tools are named `group_action` (`element_setStatus`) with the schemas of `schemas/generated/mcp-tools.json`, each with the `$defs` it uses; read commands have `readOnlyHint`. Commands of a later stage are listed with "(not implemented yet)".
- A result is the command output as `structuredContent` and as JSON text. A `CommandError` is a tool error (`isError: true`) with the error object (`common.schema.json#/$defs/error`) as JSON text only: `structuredContent` would have to match the output schema.
- No network listener at all (SR-079). Standard output carries only the protocol. The session ends when standard input ends, or with Ctrl-C.
- The official SDK `@modelcontextprotocol/server` (v2) serves both protocol eras; input validation is left to core, so errors are the same on every access (SR-080).

## Code

- `src/server.ts`: `serveMcp({ workspace, input, output, runtime?, signal? })`, `createMcpServer`, `callTool`.
- `src/tools.ts`: `catalogTools(contracts)` (the tool list as in `mcp-tools.json`), `serverTools(runtime)` (what the server offers).
- `src/transport.ts`: `LineTransport`, the stdio framing over any input stream and text sink (the CLI's streams, pipes in tests).

## Tests

`src/*.test.ts`: no network module and no socket during a session (`[SR-079/AK1]`), the tool list equals `schemas/generated/mcp-tools.json`, schemas are self-contained, results and tool errors over an SDK client. The cross-access test (`packages/cli/test/cross-access.test.ts`) compares MCP with core, CLI and API (SR-080).
