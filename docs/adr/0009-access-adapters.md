# ADR-0009: CLI, local API and MCP server

Status: Proposed · Based on: D-025, D-029 · SRs: SR-019, SR-079, SR-080, SR-081 · Contracts: `schemas/commands/catalog.json`, `schemas/generated/`

## Decision

**CLI (`packages/cli`)** — binary `logreq`.
- Subcommands generated from the catalog: `logreq <group> <action>`, the action in kebab-case (`element.setStatus` is `logreq element set-status`). Required string fields are positional arguments in schema property order (`logreq element get <ref>`); other strings, numbers and booleans are `--<field>` flags in kebab-case (`--changed-since`; booleans `--x` and `--no-x`); arrays of those repeat the flag (`--changed-files a.md --changed-files b.md`). Objects, mixed types and fields named like a common option are given with `--input <json|@file|->` (inline JSON, a file relative to the current folder, or standard input; files and standard input may be UTF-8 or UTF-16 with byte order mark, as Windows PowerShell writes them); the help names them. The field form is decided from the JSON Schema alone (`$ref`s resolved against the runtime's `contracts.schemas`), never per command. The CLI only converts number-looking values for number fields; validation is core's (`input.invalid`).
- `--input` and arguments together: `--input` is read first; positional values fill the positional fields that `--input` does not give, in order (an extra value is `input.invalid`); flags override the same field from `--input`.
- Local paths: fields that reference `common.schema.json#/$defs/localPath` are relative to the current folder on the command line; the CLI makes them absolute (from arguments, flags and `--input` alike) before the call. API and MCP pass them unchanged; commands resolve relative ones against the workspace root.
- Options follow the command (`logreq workspace check --json`); before it only `--version` (the product version embedded from the root `package.json` by `pnpm contracts:generate`, `PRODUCT_VERSION` in core) and `--help`.
- Catalog commands without implementation are listed in the help with "(not implemented yet)"; calling one gives core's `input.invalid` (exit code 2). So the help always shows the whole catalog.
- Default output is human-readable English: the output object without `problems` as YAML, then one line per problem (`severity  code  file:line  message  (element <uuid>)`, or `No problems.`). `--json` prints exactly the command output (SR-019 AK3). Problems go to stdout in both modes; errors go to stderr, as `error <code>: <message>` or, with `--json`, as the error object; with `--json` usage errors (unknown command or option) are the error object `{ "code": "input.invalid", "message": ... }` too. Output is UTF-8 and never colored.
- Closed pipe: when the reader of stdout or stderr goes away (`EPIPE`, e.g. `logreq ... | head`), the rest of that output is dropped quietly and the exit code stays the command's. Any other write error ends with exit code 3.
- Ctrl-C and SIGTERM abort the running command through its abort signal; the workspace is still closed, and the call ends with exit code 130 whenever the signal is aborted when the command finishes, whatever the command returned or failed with. A second signal ends the process at once with 130.
- Exit codes:

  | Code | Meaning |
  |---|---|
  | 0 | Success without error findings (warnings and info do not count) |
  | 1 | The output has a problem of severity `error`, or `ok: false` (SR-019, SR-025, SR-029 AK2) |
  | 2 | Usage error (unknown command or option, missing action) or a `CommandError` of any class but `internal` |
  | 3 | `internal`, any failure outside a command, or a failed write to stdout or stderr |
  | 4 | Reserved: a given commit is not available locally (SR-092 AK2); the error code comes with SR-092 |
  | 130 | Aborted (Ctrl-C, SIGTERM) |

  The exit code of an error comes from `EXIT_BY_CODE[code]` when a code has its own (only for cases like 4), else from its class (table under "Errors"). An SR that asks for exit code 1 is met by returning problems with severity `error` or `ok: false`, never by throwing: a thrown `CommandError` is a failed call, not a finding.
- Workspace discovery: `--workspace <path>` (relative to the current folder), else the nearest folder upwards with `logreq-workspace.yaml` (`findWorkspaceRoot` in core's `workspace` block), else the current folder, so `logreq workspace init` works in an empty folder. One `Workspace` per call, closed at the end; an error while closing never hides the command's own error.
- `argvFor(entry, input)` (exported by `@logreq/cli`) gives the arguments for a command input, positional and flags where they carry the value exactly and the rest in one inline `--input`, for the cross-access test.
- Parser: `commander` (MIT, pinned exactly). The CLI runs headless, without Electron (SR-080 AK3).

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

**Errors.** Every adapter maps `CommandError.code` (`common.schema.json#/$defs/error`) with one table: `errorClass(code)` and `COMMAND_ERROR_CLASSES` in `packages/core/src/catalog.ts`, which the compiler (its `Record<CommandErrorCode, ...>` type) and a test keep complete. Each adapter maps the class; the API and MCP mapping is part of #125.

| Class | Codes | CLI exit code |
|---|---|---|
| `input` | `input.invalid`, `ref.ambiguous`, `relation.not-allowed`, `variant.nested`, `reqif.invalid`, `reqif.unmapped` | 2 |
| `not-found` | `ref.unknown`, `element.not-found`, `workspace.not-found`, `file.folder-missing` | 2 |
| `conflict` | `workspace.read-only`, `element.read-only`, `file.read-only`, `file.changed-on-disk`, `file.faulty`, `file.not-regular`, `baseline.uncommitted-changes`, `metamodel.meaning-unassigned` | 2 |
| `unavailable` | `git.unavailable` | 2 |
| `internal` | `internal` | 3 |

A new code is added to the schema and to `COMMAND_ERROR_CLASSES` in the same PR; its type `Record<CommandErrorCode, ...>`, with `CommandErrorCode` generated from the schema (ADR-0003), does not compile until the new code is classified. `internal` errors carry no original error text (it stays in `cause` for local logs). Messages of `CommandError`s thrown on purpose by commands and blocks are sent as they are; they may name file paths relative to the workspace, never absolute paths or element content. A call aborted by its caller (closed window, cancelled request, the abort signal) ends as `internal` with `details.aborted: true`; there is no separate code because nobody is left to act on it.

**Same result everywhere (SR-080 AK2):** adapters only translate transport. Output objects are produced by `core`; adapters must not reshape them. The cross-access test (ADR-0011) enforces this.

**Open for stage 6:** the `mapping` fields of the `reqif.*` commands and `reqif.saveMapping.file` are typed `common.schema.json#/$defs/localPath`, but SR-054 AK1 stores the mapping "als YAML-Datei im Repository". Before stage 6 they become repository-relative, or the commands check that an absolute path lies inside a repository.

## Rejected

- MCP over HTTP/SSE: would need a port and the same protections as the API for no benefit to local agents.
- gRPC or GraphQL for the API: more tooling, harder for pipelines that use curl.
