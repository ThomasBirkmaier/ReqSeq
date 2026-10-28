# LogReq

LogReq is a local, Git-based requirements tool: one Markdown file per element, traceability, coverage and evidence, usable from a desktop app, a command line, an API and an MCP server.

This repository is built almost entirely by Claude agents. The rules they follow are in [CLAUDE.md](CLAUDE.md).

| Folder | Content |
|---|---|
| `spec/` | The specification, a LogReq workspace (D-064). Changed only with LogReq, see [spec/README.md](spec/README.md). |
| `docs/architecture/`, `docs/adr/` | arc42 (short), architecture decision records |
| `schemas/` | JSON Schemas for all file formats, OpenAPI, MCP tool list |
| `packages/` | `core`, `cli`, `api`, `mcp`, `app` |
| `verification/` | Records for analysis, inspection and demonstration |
| `toolchain/` | Examples and integration tests for the tools around LogReq (Git server, CI, Grafana, Pandoc, ...); `toolchain/junit/` connects a test tool that writes JUnit XML (SR-063) |
| `fixtures/` | Small test data per system requirement, generator for large data sets |
| `scripts/` | `trace-check`, `sr-issues`, `spec-migrate` (the one-time migration from Logseq), `spec-export` (obsolete) |

Test data for realistic scenarios lives in the separate repository `logreq-testdata`.
