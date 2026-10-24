# LogReq

LogReq is a local, Git-based requirements tool: one Markdown file per element, traceability, coverage and evidence, usable from a desktop app, a command line, an API and an MCP server.

This repository is built almost entirely by Claude agents. The rules they follow are in [CLAUDE.md](CLAUDE.md).

| Folder | Content |
|---|---|
| `spec/` | The specification, exported from the Logseq graph ReqSeq. Read-only. |
| `docs/architecture/`, `docs/adr/` | arc42 (short), architecture decision records |
| `schemas/` | JSON Schemas for all file formats, OpenAPI, MCP tool list |
| `packages/` | `core`, `cli`, `api`, `mcp`, `app` |
| `verification/` | Records for analysis, inspection and demonstration |
| `toolchain/` | Examples and integration tests for the tools around LogReq (Git server, CI, Grafana, Pandoc, ...) |
| `fixtures/` | Small test data per system requirement, generator for large data sets |
| `scripts/` | `spec-export`, `trace-check` |

Test data for realistic scenarios lives in the separate repository `logreq-testdata`.
