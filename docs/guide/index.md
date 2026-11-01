---
title: ReqSeq
description: User documentation of ReqSeq, a local, Git-based requirements tool.
---

ReqSeq is a local, Git-based requirements tool: one Markdown file per element, traceability, coverage and evidence.

You can use it in four ways, and each gives the same result:

- **App**: the desktop app for reading and editing a workspace. [Install ReqSeq](/how-to/install-reqseq/) says how to unpack and start it.
- **CLI**: the `reqseq` command line, for the terminal and for pipelines. Start with `reqseq --help`.
- **API**: a local HTTP API on loopback only, started with `reqseq serve api`.
- **MCP**: an MCP server for AI agents, started with `reqseq mcp`.

New to ReqSeq? [Get started](/start/get-started/) takes you from an empty folder to a first traced requirement. The [command reference](/reference/commands/) shows every command with its input, its output and its call in each of the four. The app's [keyboard shortcuts](/reference/keyboard-shortcuts/) are listed for Windows and Linux and for macOS. The how-to guides each show one task in all four: [install ReqSeq](/how-to/install-reqseq/), [trace a requirement](/how-to/trace-a-requirement/), [check a workspace in CI](/how-to/check-a-workspace-in-ci/), [record test evidence from JUnit XML](/how-to/record-test-evidence/) and [extend the metamodel](/how-to/extend-the-metamodel/).

The source code, the releases and the issues are on [GitHub](https://github.com/ThomasBirkmaier/ReqSeq).
