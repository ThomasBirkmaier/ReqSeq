---
title: Give acceptance criteria their keys
description: Give every acceptance criterion without a criterion key in a selection its key in one step, for files written by hand or from an older workspace.
sidebar:
  order: 4.4
---

Every acceptance criterion carries a criterion key, so a test or a record that names it by key still names it after criteria are added or moved (SR-204, D-072). ReqSeq gives the key when a criterion is created or changed. A criterion written by hand, or one from a workspace of an older version, has none until it is changed; `workspace check` reports such a requirement with the warning `element.criterion-key-missing` (SR-204 AK10).

**Assign criterion keys** gives every criterion without key in a selection its key at once. Keys that criteria have stay as they are, and so do the versions, since a key does not count to the version (SR-204 AK3, SR-091 AK6). The command names how many elements changed.

## The reference of a criterion

`reqseq element get` lists each acceptance criterion with its number, its key and the reference to copy into a test name (SR-205 AK1):

```text
acceptance-criteria:
  AK1 (kred) [SR-036/AK-kred]: Given a reading, then it shows.
  AK2: Given no reading, then a dash shows.
```

API and MCP give them as `criterionReferences`.

For a failing test, `reqseq element resolve "[SR-036/AK-kred]"` names the requirement and the criterion's number and text (SR-205 AK5); in the app, type the reference in **Go to**. A reference by number, `[SR-036/AK-xbxh]`, is refused, since a number points at another criterion once criteria move.

## App

Show the requirements you want, for example with a filter, and run **Assign criterion keys** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS). It acts on the elements the list shows.

## CLI

The commands start from a new workspace with a requirement written by hand.

```sh
reqseq workspace init . "Weather station"
```

```markdown title="system-requirement/SR-00000000a204.md"
---
id: 20420420-0000-4000-8000-00000000a204
type: system-requirement
status: draft
title: Show the wind speed
requirement-type: functional
acceptance-criteria:
  - Given wind, when it is measured, then the station shows it.
  - Given calm, then the station shows 0.
---
```

```sh
reqseq workspace check
```

```text title="Output"
ok: true
...
warning  element.criterion-key-missing  SR-00a204  This System Requirement has 2 acceptance criteria without criterion key  ...
...
```

Select the requirements with `--where-type`, or with any other selection option (`--ids`, `--filter`, `--package`):

```sh
reqseq element assign-criterion-keys --where-type system-requirement
```

```text title="Output"
count: 1
changed:
  - id: 20420420-0000-4000-8000-00000000a204
    shortId: SR-00a204
    assigned: 2
skipped: none
files:
  system-requirement/SR-00000000a204.md
```

The file now holds each criterion with its key (`- key: …` and `text: …`). Run the command again and it changes nothing.

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/element.assignCriterionKeys

{ "selection": { "where": { "type": ["system-requirement"] } } }
```

## MCP

```json
{ "name": "element_assignCriterionKeys", "arguments": { "selection": { "where": { "type": ["system-requirement"] } } } }
```
