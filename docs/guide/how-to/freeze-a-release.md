---
title: Freeze a release
description: Group the requirements of a release in a package, freeze their versions in a baseline, and see what changed since.
sidebar:
  order: 8
---

A package groups the elements of a release. A baseline freezes it: a file in the `baselines` folder of the workspace with its name, date, the commit of each repository involved and the version of each element. Later, ReqSeq shows what changed since, and gives the Git command that shows how.

ReqSeq writes the baseline file but never commits it. You commit with Git: before the baseline, because ReqSeq refuses one while files of the selection are not committed, and after it, so the baseline is part of the history. A Git tag is optional. A baseline is never replaced: a second one with the same name is refused.

## App

1. Create the package with **Create element** (Ctrl+K E, ⌘K E on macOS), type Package.
2. In the element buffer of each requirement, add the property Package with "Add property" (Ctrl+Alt+A, ⌥⌘A), choose the package, and run **Save element** (Ctrl+S, ⌘S).
3. Open the package with **Go to element or buffer** (Ctrl+P, ⌘P); its page lists its elements.
4. Commit the files with Git.
5. On the package page, open the command prompt (Ctrl+Shift+P, ⌘⇧P) and run **Create baseline**; it asks only the name. Commit the new file in `baselines/`.
6. Later, **List baselines** lists them, and **Show baseline** shows the elements of one with their state. With Ctrl+Enter (⌘↩) and `withEvidence` yes, it adds the verification status of each requirement as it stood at the baseline.
7. **Compare baseline** asks a baseline and an element and gives the two commits and the Git command. Run that command in a terminal from the workspace folder.
8. On the package page, **Export data** gives the current state of the package as JSON.

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create package "Release 1"
```

```text title="Output"
PKG-65ba20  draft  Release 1
...
```

A requirement names its packages in the property `packages`, a list:

```sh
reqseq element create system-requirement "Show the wind speed" --set 'packages=["PKG-65ba20"]'
reqseq element list --package PKG-65ba20
```

```text title="Output"
elements:
  SR-c67baa  draft  Show the wind speed
total: 1
```

`data export` gives the current state of a selection, here the package, and `--jsonl` gives one element per line:

```sh
reqseq data export --package PKG-65ba20
```

```text title="Output"
reqseq-data: 3
...
selection:
  package: PKG-65ba20
...
elements:
  SR-c67baa  draft  Show the wind speed  [verification: core open]
```

The baseline needs a Git commit, which this new folder does not have. In your repository, after you have committed the files:

1. `reqseq baseline create "Release 1" --package PKG-65ba20` writes `baselines/Release-1.yaml`. With uncommitted files in the package it refuses with `baseline.uncommitted-changes`. Commit the new file.
2. `reqseq baseline list` lists the baselines with their date and number of elements.
3. `reqseq baseline get "Release 1"` lists each element with its state, its version in the baseline and, when it differs, the current one; `--with-evidence` adds the verification status at the baseline.
4. `reqseq baseline compare "Release 1" SR-c67baa` gives the commit of the baseline, the current commit (`null` while the file has uncommitted changes), and the command to run, such as `git -C . diff <from> <to> -- system-requirement/SR-…md`. A change to a relation such as `derives-from` does not make an element `changed` in `baseline get`; this diff shows it.
5. `data export --baseline "Release 1"` gives the elements the baseline lists, as they are now.

Two baselines are two files, so `git diff --no-index baselines/Release-1.yaml baselines/Release-2.yaml` shows which elements and versions differ, one line each.

## API

With `reqseq serve api` running in the workspace, and the token of `api.json` as `Authorization: Bearer <token>`:

```http
POST /v1/commands/element.update

{ "ref": "SR-c67baa", "set": { "packages": ["PKG-65ba20"] } }
```

```http
POST /v1/commands/baseline.create

{ "name": "Release 1", "selection": { "package": "PKG-65ba20" } }
```

```http
POST /v1/commands/baseline.get

{ "baseline": "Release 1", "withEvidence": true }
```

```http
POST /v1/commands/baseline.compare

{ "baseline": "Release 1", "ref": "SR-c67baa" }
```

```http
POST /v1/commands/data.export

{ "selection": { "package": "PKG-65ba20" } }
```

The answer is the output of the command as JSON, the same as `--json` of the CLI. Commits and the Git command of `baseline.compare` are yours to run.

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools:

```json
{ "name": "element_update", "arguments": { "ref": "SR-c67baa", "set": { "packages": ["PKG-65ba20"] } } }
```

```json
{ "name": "baseline_create", "arguments": { "name": "Release 1", "selection": { "package": "PKG-65ba20" } } }
```

```json
{ "name": "baseline_get", "arguments": { "baseline": "Release 1", "withEvidence": true } }
```

```json
{ "name": "baseline_compare", "arguments": { "baseline": "Release 1", "ref": "SR-c67baa" } }
```

```json
{ "name": "data_export", "arguments": { "selection": { "package": "PKG-65ba20" } } }
```

The agent commits with Git and runs the command of `baseline_compare` in its shell.

The reference has every option of [baseline.create](/reference/commands/baseline-create/), [baseline.list](/reference/commands/baseline-list/), [baseline.get](/reference/commands/baseline-get/), [baseline.compare](/reference/commands/baseline-compare/), [data.export](/reference/commands/data-export/) and [data.store](/reference/commands/data-store/).
