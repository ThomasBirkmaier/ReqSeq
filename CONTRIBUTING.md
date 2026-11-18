# How ReqSeq is built

This repository is built almost entirely by Claude agents, against its own specification in `spec/`. The rules they follow are in [CLAUDE.md](CLAUDE.md), the way of working from need to release in [docs/process.md](docs/process.md), the architecture in [docs/architecture/](docs/architecture/README.md) and the decisions on how to build it in [docs/adr/](docs/adr/).

Each acceptance criterion with the method Test has a test named after it (`[SR-036/AK-k7f3] ...`, with the criterion's key), which `pnpm trace-check` enforces, and every pull request checks `spec/`.

Build and test with Node 22.12 or later and pnpm: `pnpm install`, `pnpm build`, `pnpm test`. The checks a pull request must pass are in [.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md).

| Folder | Content |
|---|---|
| `spec/` | The specification, a ReqSeq workspace. Changed only with ReqSeq, see [spec/README.md](spec/README.md). |
| `docs/guide/` | The user documentation's hand-written pages, built into a site by `packages/docs` (`pnpm docs:build`, ADR-0017) |
| `docs/architecture/`, `docs/adr/` | arc42 (short), architecture decision records |
| `schemas/` | JSON Schemas for all file formats, OpenAPI, MCP tool list |
| `packages/` | `core`, `cli`, `api`, `mcp`, `app`, `docs` (the documentation site), `testkit` (shared test helpers) |
| `verification/` | Records for analysis, inspection and demonstration |
| `toolchain/` | `junit/` connects a test tool that writes JUnit XML (SR-063); `packaging/` builds the release archives; `reqif/` lists the ReqIF 1.2 XSDs that CI downloads and pins by hash for the tests |
| `fixtures/` | Small test data per system requirement, generator for large data sets |
| `scripts/` | `trace-check`, `spec-migrate` (the one-time migration from Logseq), `spec-export` (obsolete) |

References of the form `ThomasBirkmaier/ReqSeq-archive#N` point to issues and pull requests of an earlier repository that is not public.
