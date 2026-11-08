---
title: Remove a draft
description: Remove an element that was never approved and is in no baseline, without leaving links to it behind.
sidebar:
  order: 6
---

ReqSeq never deletes an element: one that was approved or is in a baseline is replaced with **Supersede element** (`reqseq element supersede`), so its history stays. A draft that was never approved and is in no baseline you can remove yourself with Git, in three steps:

1. Find the elements that link to it and remove those links.
2. Remove its file with `git rm`, or delete the file if Git does not track it yet.
3. Run `workspace check`, which reports any link left behind as the error `relation.missing-target`.

ReqSeq itself does not remove the file, because it never writes to Git.

## App

1. Open the draft and run **Show neighbourhood** (Ctrl+J, ⌘J on macOS) to see the elements that link to it.
2. Open each of them and run **Remove relation** with the kind and the draft as target. An inline reference or a relation property that names the draft is removed by changing the text or the property.
3. Remove the file with `git rm` in a terminal; the app does not remove files.
4. Run **Check workspace** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS).

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed"
```

```text title="Output"
N-7fe707  draft  See the wind speed  [validation: open]
files:
  need/N-d0e44b7fe707.md
No problems.
```

```sh
reqseq element create system-requirement "Show the wind speed" --relations derives-from=N-7fe707
```

```text title="Output"
SR-c67baa  draft  Show the wind speed  [verification: core open]
...
```

Before the need can go, find what links to it. `--direction down` lists every element whose file has a relation, a relation property or an inline reference to it, and `--json` names the kind of each link:

```sh
reqseq trace neighbourhood N-7fe707 --direction down
```

```text title="Output"
N-7fe707  draft  See the wind speed
children:
  1  SR-c67baa  draft  Show the wind speed  [not expanded]
total: 2
```

Remove each relation; an inline reference or a relation property is changed with `element update`. `element get` shows the file of the need:

```sh
reqseq relation remove SR-c67baa derives-from N-7fe707
reqseq element get N-7fe707
```

```text title="Output"
N-7fe707  draft  See the wind speed  [validation: open]
...
  file: ...need/N-d0e44b7fe707.md
...
```

Remove the file with Git and check the workspace. In this new workspace nothing is committed yet, so delete the file with `rm need/N-d0e44b7fe707.md` instead; in a checkout where the file is committed, use:

```sh
git rm need/N-d0e44b7fe707.md
```

```sh
reqseq workspace check
```

```text title="Output"
ok: true
...
warning  trace.no-parent  SR-c67baa  ...
```

No error is left. The warning says that the requirement now derives from nothing, so give it another parent or remove it the same way.

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace:

```http
POST /v1/commands/trace.neighbourhood

{ "ref": "N-7fe707", "direction": "down" }
```

```http
POST /v1/commands/relation.remove

{ "source": "SR-c67baa", "kind": "derives-from", "target": "N-7fe707" }
```

Remove the file with `git rm` (not possible through the API), then:

```http
POST /v1/commands/workspace.check

{}
```

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools:

```json
{ "name": "trace_neighbourhood", "arguments": { "ref": "N-7fe707", "direction": "down" } }
```

```json
{ "name": "relation_remove", "arguments": { "source": "SR-c67baa", "kind": "derives-from", "target": "N-7fe707" } }
```

The agent removes the file with `git rm` in its shell (not possible through MCP), then calls:

```json
{ "name": "workspace_check", "arguments": {} }
```
