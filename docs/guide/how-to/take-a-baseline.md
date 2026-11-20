---
title: Take a baseline
description: Freeze the versions of a selection of elements in a baseline, such as the elements of a package, and see what changed since.
sidebar:
  order: 8
---

A baseline is a named state that no longer changes: a file in the baseline folder (`baselines` in the main repository unless the workspace file names another) with its name, date, the commit of each repository involved and the version of each selected element. The selection is a package, a variant, a filter or IDs; here a package: elements you declare to belong together for any reason, such as all requirements of a use case. When and why you take a baseline is up to you.

ReqSeq never commits the file. Commit before the baseline, because ReqSeq refuses one while the files of the selection, their images, the metamodel or the workspace file are uncommitted, and after it. A second baseline with the same name is refused.

## App

1. Create the package with **Create element** (Ctrl+K E, ⌘K E on macOS), type Package.
2. In the element buffer of each requirement, add the property Package with "Add property" (Ctrl+Alt+A, ⌥⌘A), choose the package, and run **Save element** (Ctrl+S, ⌘S).
3. Open the package with **Go to element or buffer** (Ctrl+P, ⌘P); its page lists its elements.
4. Commit the files with Git.
5. On the package page, open the command prompt (Ctrl+Shift+P, ⌘⇧P) and run **Prepare baseline**: the problems of **Check workspace** for the whole workspace, the verification degree of the package, the number of requirements of its view without a passed test, and the changes since the newest baseline, with **Create baseline** as the next step. It blocks nothing.
6. Run **Create baseline**; it asks only the name. Commit the new file.
7. Later, **Show changes since baseline** gives the numbers of **Show baseline** for the newest baseline, or for the one you give with Ctrl+Enter (⌘↩), and the open hints, with **Confirm hints**, **Compare baseline** and **Prepare baseline** as next steps.
8. **List baselines** lists them, and **Show baseline** shows the elements of one with their state. It warns `baseline.repository-commit-differs` when a repository is at another commit than the baseline names. With Ctrl+Enter (⌘↩) and `withEvidence` yes, it adds the verification and validation status at the baseline ([evidence at a baseline](/how-to/record-evidence-for-a-variant/)).
9. **Compare baseline** asks a baseline and an element and gives the two commits and the Git command. Run it from the workspace folder.
10. On the package page, **Export data** shows the current state of the package in a result buffer.

## CLI

In your workspace, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create package "Wind measurement"
```

```text title="Output"
Created Package PKG-65ba20; 1 file written.
PKG-65ba20  draft  Wind measurement
...
```

A requirement names its packages in the property `packages`, a list of every package it belongs to:

```sh
reqseq element create system-requirement "Show the wind speed" --set 'packages=["PKG-65ba20"]'
reqseq element list --package PKG-65ba20
```

```text title="Output"
Listed 1 element.
elements:
  SR-c67baa  draft  Show the wind speed
total: 1
```

`data export` gives the current state of the package:

```sh
reqseq data export --package PKG-65ba20
```

```text title="Output"
Exported 1 element of workspace Weather station.
reqseq-data: 5
...
selection:
  package: PKG-65ba20
...
elements:
  SR-c67baa  draft  Show the wind speed  [verification: core open]
```

A baseline needs committed files, so in your repository, after a commit:

1. `reqseq baseline prepare --package PKG-65ba20` gives the problems of `workspace check` for the whole workspace, the verification degree of the package as `evidence degree`, the number of `evidence without-passed-test` for its view and the numbers of `baseline get` for the newest baseline, and under `next:` the call of `baseline create` with the package. It leaves that call out for a selection `baseline create` refuses (a baseline, a command output, a saved filter with another view than its own) and while the workspace is read-only.
2. `reqseq baseline create "Review 1" --package PKG-65ba20` writes `Review-1.yaml` in the baseline folder. With uncommitted files it refuses with `baseline.uncommitted-changes`. Commit the new file.
3. `reqseq baseline list` lists them with date and element count.
4. `reqseq baseline get "Review 1"` lists each element with its state, its version in the baseline and, when it differs, the current one; `--with-evidence` adds the verification and validation status at the baseline (see the warning above).
5. `reqseq baseline compare "Review 1" SR-c67baa` gives the commit of the baseline, the current one (`null` while uncommitted), and the command, such as `git -C . diff <from> <to> -- system-requirement/SR-…md`. A change to a relation such as `derives-from` does not make an element `changed` in `baseline get`; this diff shows it.
6. `reqseq baseline changes` compares with the newest baseline (the latest date and time; `reqseq baseline changes --baseline "Review 1"` takes that one): the numbers of `baseline get`, the open hints of `hint list`, and under `next:` `hint confirm` when a hint can be confirmed, `baseline compare` when an element changed, and `baseline prepare`.
7. `reqseq data export --baseline "Review 1"` gives the elements the baseline lists, as they are now.

Two baselines are two files, so `git diff --no-index baselines/Review-1.yaml baselines/Review-2.yaml` shows which elements and versions differ.

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token; `set` writes the whole list, so list every package the element belongs to:

```http
POST /v1/commands/element.update

{ "ref": "SR-c67baa", "set": { "packages": ["PKG-65ba20"] } }
```

```http
POST /v1/commands/baseline.create

{ "name": "Review 1", "selection": { "package": "PKG-65ba20" } }
```

```http
POST /v1/commands/baseline.prepare

{ "selection": { "package": "PKG-65ba20" } }
```

```http
POST /v1/commands/baseline.changes

{}
```

```http
POST /v1/commands/baseline.list

{}
```

```http
POST /v1/commands/baseline.get

{ "baseline": "Review 1", "withEvidence": true }
```

```http
POST /v1/commands/baseline.compare

{ "baseline": "Review 1", "ref": "SR-c67baa" }
```

```http
POST /v1/commands/data.export

{ "selection": { "package": "PKG-65ba20" } }
```

The answer is the JSON of the CLI's `--json`. Commits and the Git command of `baseline.compare` are yours to run.

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools:

```json
{ "name": "element_update", "arguments": { "ref": "SR-c67baa", "set": { "packages": ["PKG-65ba20"] } } }
```

```json
{ "name": "baseline_create", "arguments": { "name": "Review 1", "selection": { "package": "PKG-65ba20" } } }
```

```json
{ "name": "baseline_prepare", "arguments": { "selection": { "package": "PKG-65ba20" } } }
```

```json
{ "name": "baseline_changes", "arguments": {} }
```

```json
{ "name": "baseline_list", "arguments": {} }
```

```json
{ "name": "baseline_get", "arguments": { "baseline": "Review 1", "withEvidence": true } }
```

```json
{ "name": "baseline_compare", "arguments": { "baseline": "Review 1", "ref": "SR-c67baa" } }
```

```json
{ "name": "data_export", "arguments": { "selection": { "package": "PKG-65ba20" } } }
```

The agent commits with Git and runs the command of `baseline_compare` in its shell.

The reference has every option of [baseline.prepare](/reference/commands/baseline-prepare/), [baseline.create](/reference/commands/baseline-create/), [baseline.changes](/reference/commands/baseline-changes/), [baseline.list](/reference/commands/baseline-list/), [baseline.get](/reference/commands/baseline-get/), [baseline.compare](/reference/commands/baseline-compare/) and [data.export](/reference/commands/data-export/).
