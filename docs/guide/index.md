---
title: ReqSeq
description: User documentation of ReqSeq, a local, Git-based requirements tool.
---

You tell your coding agent what you need, and it writes it down as requirements, acceptance criteria and tests, as Markdown files in your repository, through ReqSeq's CLI or MCP server.
Every element and every link between them carries a version, from the need down to the test run that proves it, so a change shows at once which requirement must be reviewed and which test must run again.
Only people approve; ReqSeq never sets a status, never writes to Git and opens no network connection.

![ReqSeq in the middle with its four ways in: you work in the desktop app, you and an AI assistant over MCP, a coding agent and a CI pipeline over the CLI, and scripts and tools over the local API. ReqSeq reads and writes the spec as Markdown files in a workspace folder of your Git repository, such as spec/, reads Git and never commits, and opens no network connections.](./images/context.svg)

You can use it in four ways, and each gives the same result ([CLI, API and MCP](/concepts/cli-api-and-mcp/) explains the three besides the app):

- **App**: the desktop app for reading and editing a workspace. [Install ReqSeq](/how-to/install-reqseq/) says how to unpack and start it.
- **CLI**: the `reqseq` command line, for the terminal and for pipelines. Start with `reqseq --help`.
- **API**: a local HTTP API on loopback only, started with `reqseq serve api`.
- **MCP**: an MCP server for AI agents, started with `reqseq mcp`.

## What it does

- **Plain files.** Each need, use case, system requirement, decision, variant and package is one Markdown file with its properties in the frontmatter, in folders you keep in Git. ReqSeq reads Git but never writes to it, and it never deletes an element: it supersedes it.
- **Your metamodel.** Types, properties, relation kinds and statuses belong to the workspace; a new workspace starts with the standard model. Statuses are set by people; ReqSeq never computes them.
- **Traceability.** A relation keeps the version of its target, so a changed target shows the relation as outdated. Trace chains, related and affected elements, a traceability matrix and a graph.
- **Evidence and coverage.** Verification and validation records, and JUnit XML results of tests that name the requirement they test; coverage, verification degree and the requirements without a passed test.
- **Checks in pipelines.** `reqseq workspace check` checks the whole workspace, or only the changed files, and exits with 1 on errors.
- **Variants, baselines and exchange.** Variants that exclude or replace requirements of the core, baselines to compare against, ReqIF import and export, and data export.

## Where to read on

New to ReqSeq? [Get started](/start/get-started/) takes you from an empty folder to a first traced requirement. The [command reference](/reference/commands/) shows every command with its input, its output and its call in each of the four. [The app](/concepts/the-app/) explains the command prompt, buffers and the other parts of the desktop app, and its [keyboard shortcuts](/reference/keyboard-shortcuts/) are listed for Windows and Linux and for macOS. The how-to guides each show one task in all four: [install ReqSeq](/how-to/install-reqseq/), [open or create a workspace](/how-to/open-a-workspace/), [trace a requirement](/how-to/trace-a-requirement/), [check a workspace in CI](/how-to/check-a-workspace-in-ci/), [record test evidence from JUnit XML](/how-to/record-test-evidence/), [name the requirement in a test](/how-to/name-the-requirement-in-a-test/), [give acceptance criteria their keys](/how-to/give-acceptance-criteria-their-keys/), [record test results in CI](/how-to/record-test-results-in-ci/), [record evidence for a variant](/how-to/record-evidence-for-a-variant/), [extend the metamodel](/how-to/extend-the-metamodel/), [choose what counts to the version](/how-to/choose-what-counts-to-the-version/), [limit relations and list entries](/how-to/limit-relations-and-list-entries/), [remove a draft](/how-to/remove-a-draft/), [find and filter elements](/how-to/find-and-filter-elements/), [review and approve a requirement](/how-to/review-and-approve-a-requirement/), [take a baseline](/how-to/take-a-baseline/), [manage a product variant](/how-to/manage-a-product-variant/) and [exchange requirements with ReqIF](/how-to/exchange-requirements-with-reqif/).

The source code, the releases and the issues are on [GitHub](https://github.com/ThomasBirkmaier/ReqSeq).
