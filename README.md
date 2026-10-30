# ReqSeq

ReqSeq is a local, Git-based requirements tool: one Markdown file per element, traceability, coverage and evidence.

[![CI](https://github.com/ThomasBirkmaier/ReqSeq/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ThomasBirkmaier/ReqSeq/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/ThomasBirkmaier/ReqSeq)](https://github.com/ThomasBirkmaier/ReqSeq/releases/latest)
[![License: all rights reserved](https://img.shields.io/badge/license-all%20rights%20reserved-lightgrey)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-thomasbirkmaier.github.io%2FReqSeq-blue)](https://thomasbirkmaier.github.io/ReqSeq/)

You keep your requirements as plain files in your own folders and repositories. ReqSeq reads them, checks them against a metamodel, follows their relations and shows what is covered and verified, from a desktop app, a command line, a local API and an MCP server.

## What it does

- **Plain files.** Each need, use case, system requirement, decision, variant and package is one Markdown file with its properties in the frontmatter, in folders you keep in Git. ReqSeq reads Git but never writes to it, and it never deletes an element: it supersedes it.
- **Your metamodel.** Types, properties, relation kinds and statuses belong to the workspace; a new workspace starts with the standard model. Statuses are set by people; ReqSeq never computes them.
- **Traceability.** A relation keeps the version of its target, so a changed target shows the relation as outdated. Trace chains, related and affected elements, a traceability matrix and a graph.
- **Evidence and coverage.** Verification and validation records, and JUnit XML results of tests that name the requirement they test; coverage, verification degree and the requirements without a passed test.
- **Checks in pipelines.** `reqseq workspace check` checks the whole workspace, or only the changed files, and exits with 1 on errors.
- **Variants, baselines and exchange.** Variants that exclude or replace requirements of the core, baselines to compare against, ReqIF import and export, and data export.
- **Four ways in, one result.** The desktop app, the `reqseq` command line, a local HTTP API on loopback and an MCP server for AI agents run the same commands.

## Get started

1. Download the artifact for your system from the [latest release](https://github.com/ThomasBirkmaier/ReqSeq/releases/latest) and unpack it. [Getting ReqSeq](docs/delivery/README.md) lists the artifacts and says how to install them; ReqSeq needs `git` on the PATH.
2. In an empty folder, create a workspace, a first need and a requirement derived from it, look at the chain and check the workspace. Use the short IDs that ReqSeq prints in place of `N-7fe707` and `SR-c67baa`:

```sh
reqseq --version
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed" --text "As a sailor, I want to see the wind speed before I leave the harbour."
reqseq element create system-requirement "Show the wind speed" --text "The station must show the wind speed in knots, updated every 10 seconds."
reqseq relation add SR-c67baa derives-from N-7fe707
reqseq trace chain N-7fe707
reqseq workspace check
```

[Get started](https://thomasbirkmaier.github.io/ReqSeq/start/get-started/) in the documentation explains each step and how the app does the same.

## Documentation

The documentation is at **[thomasbirkmaier.github.io/ReqSeq](https://thomasbirkmaier.github.io/ReqSeq/)**: Get started, and a reference of every command with its call in the app, the CLI, the API and MCP, every problem and error code, and every file format.

## Reporting bugs

Open an [issue](https://github.com/ThomasBirkmaier/ReqSeq/issues) with the version (`reqseq --version`), your system, what you did and what happened.

## Data and privacy

ReqSeq works on your files only. It opens no network connections and sends no telemetry; the local API listens on loopback only.

## Development

This repository is built almost entirely by Claude agents, against its own specification in `spec/`. The rules they follow are in [CLAUDE.md](CLAUDE.md), the architecture in [docs/architecture/](docs/architecture/README.md) and the decisions on how to build it in [docs/adr/](docs/adr/).

Build and test with Node 22.12 or later and pnpm: `pnpm install`, `pnpm build`, `pnpm test`. The checks a pull request must pass are in [.claude/skills/verify/SKILL.md](.claude/skills/verify/SKILL.md).

| Folder | Content |
|---|---|
| `spec/` | The specification, a ReqSeq workspace (D-064). Changed only with ReqSeq, see [spec/README.md](spec/README.md). |
| `docs/guide/` | The user documentation's hand-written pages, built into a site by `packages/docs` (`pnpm docs:build`, ADR-0017) |
| `docs/architecture/`, `docs/adr/` | arc42 (short), architecture decision records |
| `schemas/` | JSON Schemas for all file formats, OpenAPI, MCP tool list |
| `packages/` | `core`, `cli`, `api`, `mcp`, `app`, `docs` (the documentation site) |
| `verification/` | Records for analysis, inspection and demonstration |
| `toolchain/` | `junit/` connects a test tool that writes JUnit XML (SR-063); `packaging/` builds the release archives |
| `fixtures/` | Small test data per system requirement, generator for large data sets |
| `scripts/` | `trace-check`, `sr-issues`, `spec-migrate` (the one-time migration from Logseq), `spec-export` (obsolete) |

Test data for realistic scenarios lives in the separate repository `ReqSeq-testdata`.

## License

Copyright (c) 2026 Thomas Birkmaier. All rights reserved. No license is granted; see [LICENSE](LICENSE).
