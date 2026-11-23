# @reqseq/mcp

The MCP server of ReqSeq (ADR-0009) for AI agents: stdio only, one tool per command of the catalog of `@reqseq/core` (ADR-0002). It has no logic of its own; every tool call is one `invoke` call. Started by `reqseq mcp`.

```json
{ "mcpServers": { "reqseq": { "command": "reqseq", "args": ["mcp", "--workspace", "/path/to/copy"] } } }
```

- Tools are named `group_action` (`element_setStatus`) with the input schemas of `schemas/generated/mcp-tools.json`, each with only the definitions it reaches, flat (`#/$defs/common.uuid`); only `element_search` carries the whole filter condition, every other tool a stub that names it (#1927); no output schemas, so the list stays small (about 160 KB with 62 tools, #1927; 1 MB in ThomasBirkmaier/ReqSeq-archive#303); read commands have `readOnlyHint`, and the commands with `deletes` in the catalog (`perspective_delete`, `filter_delete`) have `destructiveHint`, and the commands with `loadUpfront` in the catalog carry `_meta: { "anthropic/alwaysLoad": true }`, so Claude Code loads them with their schemas at once (ADR-0009). Only implemented commands are listed; a call to a catalog command of a later stage gives the tool error `command.not-implemented`, as CLI and API do.
- The `initialize` result carries the MCP server instructions as its `instructions`: the output of `tool.guide` with `instructions`, the rules of the agent guide and the call that reads the guide, the same for every folder (SR-229). The server calls the command once before it serves and adds no text of its own.
- A result is the command output as `structuredContent` and as JSON text; above 32 MiB of JSON (`MAX_TEXT_BYTES`) the text is a note pointing to `data_store` (ADR-0009). A `CommandError` is a tool error (`isError: true`) with the error object (`common.schema.json#/$defs/error`) as JSON text only: `structuredContent` is always the command output.
- No network listener at all (SR-079). Standard output carries only the protocol. The session ends when standard input ends, or with Ctrl-C.
- The official SDK `@modelcontextprotocol/server` (v2) serves both protocol eras; input validation is left to core, so errors are the same on every access (SR-080).

## Code

- `src/server.ts`: `serveMcp({ workspace, input, output, runtime?, signal? })`, `createMcpServer` (an `McpServer` with its own `tools/list` and `tools/call` handlers), `callTool`.
- `src/tools.ts`: `catalogTools(contracts)` (the tool list as in `mcp-tools.json`), `serverTools(runtime)` (what the server lists).
- `src/transport.ts`: `LineTransport`, the stdio framing over any input stream and text sink (the CLI's streams, pipes in tests); it writes each message in chunks through a send queue with back-pressure.

## Tests

`src/*.test.ts`: no network module and no socket during a session (`[SR-079/AK-g12j]`), the tool list equals `schemas/generated/mcp-tools.json` (with the stub of the filter condition outside `element_search`), the filter grammar is in `element_search` only, schemas are self-contained and pruned, `tools/list` stays within its size bounds (each tool without its selection part, the full and the stub selection part, the whole list; ADR-0009), the tools with `_meta` are exactly the `loadUpfront` entries and include the first commands of the instructions, results and tool errors over an SDK client. The cross-access test (`packages/cli/test/cross-access.test.ts`) compares MCP with core, CLI and API (SR-080).
