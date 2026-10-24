# ADR-0009: CLI, local API and MCP server

Status: Proposed · Based on: D-025, D-029 · SRs: SR-019, SR-079, SR-080, SR-081 · Contracts: `schemas/commands/catalog.json`, `schemas/generated/`

## Decision

**CLI (`packages/cli`)** — binary `logreq`.
- Subcommands generated from the catalog: `logreq element get <ref>`, positional arguments for required string fields, `--<field>` flags for others, `--input <json|@file|->` for complex input.
- Default output is human-readable English; `--json` prints exactly the command output (SR-019 AK3). Problems go to stdout in JSON mode, errors to stderr.
- Exit codes: `0` success without findings, `1` findings of severity error, or a check failed (SR-019, SR-025, SR-029 AK2), `2` usage or input error, `3` internal error.
- Workspace discovery: `--workspace <path>`, else the nearest folder upwards with `logreq-workspace.yaml`.
- Parser: `commander`. The CLI runs headless, without Electron (SR-080 AK3).

**API (`packages/api`)** — `logreq serve api`.
- `node:http`, bound to `127.0.0.1` and `::1` only. There is no option to bind elsewhere (SR-079 AK1, AK3); the bind address is a constant and a test greps for it.
- `POST /v1/commands/<name>` with the command input as JSON body; `GET /v1/commands` returns the catalog.
- Authentication: a random 256-bit token generated at start and written with mode 0600 to `<cache>/api.json` together with the port; clients send `Authorization: Bearer <token>`. Requests with a `Host` header other than `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` are rejected (DNS rebinding), and so are requests with an `Origin` header (no browser access).
- Port: `--port`, default 0 (any free port, SR-081).

**MCP server (`packages/mcp`)** — `logreq mcp`.
- Official `@modelcontextprotocol/sdk`, **stdio** transport only. No network listener at all (SR-079).
- One tool per command (`group_action`), input and output schemas from `schemas/generated/mcp-tools.json`; read commands carry `readOnlyHint`. Results as structured content plus a short text rendering.
- LogReq never starts or controls agents (D-029).

**App** calls the same commands via IPC (ADR-0010).

**Same result everywhere (SR-080 AK2):** adapters only translate transport. Output objects are produced by `core`; adapters must not reshape them. The cross-access test (ADR-0011) enforces this.

## Rejected

- MCP over HTTP/SSE: would need a port and the same protections as the API for no benefit to local agents.
- gRPC or GraphQL for the API: more tooling, harder for pipelines that use curl.
