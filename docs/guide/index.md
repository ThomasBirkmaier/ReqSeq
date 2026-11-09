---
title: ReqSeq
description: User documentation of ReqSeq, a local, Git-based requirements tool.
---

ReqSeq is a local, Git-based requirements tool: one Markdown file per element, traceability, coverage and evidence.

![ReqSeq in the middle with its four ways in: you work in the desktop app, you and an AI assistant over MCP, a coding agent and a CI pipeline over the CLI, and scripts and tools over the local API. ReqSeq reads and writes the spec as Markdown files in a workspace folder of your Git repository, such as spec/, reads Git and never commits, and opens no network connections.](./images/context.svg)

You can use it in four ways, and each gives the same result ([CLI, API and MCP](/concepts/cli-api-and-mcp/) explains the three besides the app):

- **App**: the desktop app for reading and editing a workspace. [Install ReqSeq](/how-to/install-reqseq/) says how to unpack and start it.
- **CLI**: the `reqseq` command line, for the terminal and for pipelines. Start with `reqseq --help`.
- **API**: a local HTTP API on loopback only, started with `reqseq serve api`.
- **MCP**: an MCP server for AI agents, started with `reqseq mcp`.

New to ReqSeq? [Get started](/start/get-started/) takes you from an empty folder to a first traced requirement. The [command reference](/reference/commands/) shows every command with its input, its output and its call in each of the four. [The app](/concepts/the-app/) explains the command prompt, buffers and the other parts of the desktop app, and its [keyboard shortcuts](/reference/keyboard-shortcuts/) are listed for Windows and Linux and for macOS. The how-to guides each show one task in all four: [install ReqSeq](/how-to/install-reqseq/), [open or create a workspace](/how-to/open-a-workspace/), [trace a requirement](/how-to/trace-a-requirement/), [check a workspace in CI](/how-to/check-a-workspace-in-ci/), [record test evidence from JUnit XML](/how-to/record-test-evidence/), [name the requirement in a test](/how-to/name-the-requirement-in-a-test/), [record test results in CI](/how-to/record-test-results-in-ci/), [record evidence for a variant](/how-to/record-evidence-for-a-variant/), [extend the metamodel](/how-to/extend-the-metamodel/), [choose what counts to the version](/how-to/choose-what-counts-to-the-version/), [limit relations and list entries](/how-to/limit-relations-and-list-entries/), [remove a draft](/how-to/remove-a-draft/), [find and filter elements](/how-to/find-and-filter-elements/), [review and approve a requirement](/how-to/review-and-approve-a-requirement/), [freeze a release](/how-to/freeze-a-release/), [manage a product variant](/how-to/manage-a-product-variant/) and [exchange requirements with ReqIF](/how-to/exchange-requirements-with-reqif/).

The source code, the releases and the issues are on [GitHub](https://github.com/ThomasBirkmaier/ReqSeq).
