---
title: Prepare a baseline and see what changed
description: Before a baseline, see the problems of the check, the verification degree and the changes since the newest baseline; later, see what changed since a baseline and which hints are open.
sidebar:
  order: 15
---

Two commands gather the outputs of other commands in one output and name the next steps as commands. Each number they give is the one the other command gives. They only read, and they block nothing: whether and when you [take a baseline](/how-to/take-a-baseline/) is up to you.

- **Prepare baseline** (`baseline.prepare`) gives the problems of **Check workspace** for the whole workspace, the verification degree of a selection as **Show verification degree** gives it, the number of requirements of its view without a passed test, and the numbers of **Show baseline** for the newest baseline. Its next steps are **Create baseline** with the same selection, only the name open, and **Show changes since baseline** when there is a baseline.
- **Show changes since baseline** (`baseline.changes`) gives the numbers of **Show baseline** for the newest baseline, the one with the latest date and time, or for the one you name, and the open hints as **List hints** gives them without a filter. Its next steps are **Confirm hints** when a hint can be confirmed, **Compare baseline** when an element changed, and **Prepare baseline**.

**Create baseline** is left out for a selection it refuses: a baseline, the output of a command, or a saved filter with another view than its own. While the workspace is read-only, every step whose command is then refused is left out.

## App

1. On a package page, open the command prompt (Ctrl+Shift+P, ⌘⇧P) and run **Prepare baseline**. Its next steps include **Create baseline**; Enter on it asks only the name.
2. Later, run **Show changes since baseline**; Ctrl+Enter (⌘↩) asks a baseline first. Several hints of one kind show as one line with the kind and their count, and Tab unfolds it.

## CLI

1. `reqseq baseline prepare --package PKG-65ba20` lists under `next:` the call `reqseq baseline create <name> --package PKG-65ba20`.
2. `reqseq baseline changes` compares with the newest baseline, `reqseq baseline changes --baseline "Review 1"` with that one.

## API

```http
POST /v1/commands/baseline.prepare

{ "selection": { "package": "PKG-65ba20" } }
```

```http
POST /v1/commands/baseline.changes

{}
```

## MCP

```json
{ "name": "baseline_prepare", "arguments": { "selection": { "package": "PKG-65ba20" } } }
```

```json
{ "name": "baseline_changes", "arguments": {} }
```

The reference has every option of [baseline.prepare](/reference/commands/baseline-prepare/) and [baseline.changes](/reference/commands/baseline-changes/).
