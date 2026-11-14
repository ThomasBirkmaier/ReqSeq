---
title: Review and approve a requirement
description: Set the status of requirements, review them after a parent changed, and supersede an approved requirement by a new one.
sidebar:
  order: 11
---

The status of an element is one of the statuses its type has in the metamodel. In the standard model these are `draft` (the status of a new element), `approved` and `obsolete`, which the metamodel marks invalid. ReqSeq never sets a status itself: only you do, and a change to an approved element leaves it approved. Instead, ReqSeq marks the relations that point to the changed element as outdated, and those hints tell you what to review.

ReqSeq never deletes an element. You supersede an approved one: it gets an invalid status, and a successor, if there is one, can name it with `supersedes`, so the chain and its evidence stay traceable. A draft that was never approved and is in no baseline you can [remove](/how-to/remove-a-draft/).

## App

1. Open the element and run **Set status** (Ctrl+K T, ⌘K T on macOS). It offers the shown element first; add more elements one per Enter, end the list with an empty Enter, and choose Approved. A right-click on the status in the modeline offers it too.
2. To set another property for every element of a list, open the command prompt on the list (Ctrl+Shift+P, ⌘⇧P) and run **Bulk update elements**. It shows what it would change; run it again with Ctrl+Enter (⌘↩) and `confirm` yes to write it.
3. Before you change an element, **Show affected elements** lists the elements that trace to it.
4. After the change, each requirement that derives from the need shows "link outdated" next to the need. **List hints** lists all such hints. Review each requirement and set it back to Draft with **Set status** if it needs more work. Then run **Confirm hints** (Ctrl+K H, ⌘K H) on it, which clears the mark; the app confirms one requirement at a time.
5. To supersede an element, create its successor with **Create element** (Ctrl+K E, ⌘K E). Then run **Supersede element** on the old one and choose Obsolete; with Ctrl+Enter (⌘↩) you can name the successor.

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed"
```

```text title="Output"
N-7fe707  draft  See the wind speed  [validation: open]
...
```

```sh
reqseq element create system-requirement "Show the wind speed" --relations derives-from=N-7fe707
```

```text title="Output"
SR-c67baa  draft  Show the wind speed  [verification: core open]
...
```

```sh
reqseq element create system-requirement "Warn of gusts" --relations derives-from=N-7fe707
```

```text title="Output"
SR-5e1d0a  draft  Warn of gusts  [verification: core open]
...
```

`element bulk-update` changes one property, never the status, for every element of a selection. Without `--confirm` it only shows what it would change:

```sh
reqseq element bulk-update verification-method set --where-type system-requirement --input '{"value":"test"}'
```

```text title="Output"
applied: false
count: 2
...
```

With `--confirm`, `--expected` refuses the write when the count is no longer that of the preview. `--plan` with the preview's `plan` is stricter: it refuses unless the same files get the same bytes.

```sh
reqseq element bulk-update verification-method set --where-type system-requirement --input '{"value":"test"}' --confirm --expected 2
```

```text title="Output"
applied: true
count: 2
...
```

`element set-status` takes several elements at once:

```sh
reqseq element set-status approved --refs N-7fe707 --refs SR-c67baa --refs SR-5e1d0a
```

```text title="Output"
files:
...
No problems.
```

Before you change the need, see what traces to it:

```sh
reqseq trace affected N-7fe707
```

```text title="Output"
affected:
  1  ...  [via derives-from]
  1  ...  [via derives-from]
total: 2
...
```

A change to the text or to a property that counts for the version, such as the validation criteria, gives the need a new version:

```sh
reqseq element update N-7fe707 --set 'validation-criteria=["A sailor reads the wind speed in the harbour."]'
reqseq hint list --kind relation.outdated
```

```text title="Output"
kinds:
  - code: relation.outdated
    count: 2
hints:
  ... → N-7fe707  See the wind speed  relation.outdated  ...
  ... → N-7fe707  See the wind speed  relation.outdated  ...
total: 2
```

Both requirements are still approved. Review them and set back to `draft` what needs work. Then confirm the hints that point to the need, or one requirement's with `--ref`:

```sh
reqseq hint confirm --target N-7fe707
```

```text title="Output"
confirmed:
...
No problems.
```

To supersede the gust warning, create its successor, then supersede the old one:

```sh
reqseq element create system-requirement "Warn of gusts and squalls" --relations derives-from=N-7fe707
```

```text title="Output"
SR-62fb87  draft  Warn of gusts and squalls  [verification: core open]
...
```

```sh
reqseq element supersede SR-5e1d0a obsolete --successor SR-62fb87
reqseq element get SR-62fb87
```

```text title="Output"
...
    - -> supersedes  SR-5e1d0a  Warn of gusts
...
```

Only a status the metamodel marks invalid supersedes; `approved` is refused with `input.invalid`.

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/element.setStatus

{ "refs": ["N-7fe707", "SR-c67baa", "SR-5e1d0a"], "status": "approved" }
```

```http
POST /v1/commands/element.bulkUpdate

{ "selection": { "where": { "type": ["system-requirement"] } }, "property": "verification-method", "operation": "set", "value": "test" }
```

The preview's answer has `plan`; send the same input again with `"confirm": true, "plan": "p1:<plan of the preview>"` to write it.

```http
POST /v1/commands/trace.affected

{ "ref": "N-7fe707" }
```

```http
POST /v1/commands/hint.list

{ "kind": ["relation.outdated"] }
```

```http
POST /v1/commands/hint.confirm

{ "target": "N-7fe707" }
```

```http
POST /v1/commands/element.supersede

{ "ref": "SR-5e1d0a", "status": "obsolete", "successor": "SR-62fb87" }
```

The answer is the output of the command as JSON, the same as `--json` of the CLI.

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools:

```json
{ "name": "element_setStatus", "arguments": { "refs": ["N-7fe707", "SR-c67baa", "SR-5e1d0a"], "status": "approved" } }
```

```json
{ "name": "element_bulkUpdate", "arguments": { "selection": { "where": { "type": ["system-requirement"] } }, "property": "verification-method", "operation": "set", "value": "test" } }
```

```json
{ "name": "element_bulkUpdate", "arguments": { "selection": { "where": { "type": ["system-requirement"] } }, "property": "verification-method", "operation": "set", "value": "test", "confirm": true, "plan": "p1:<plan of the preview>" } }
```

```json
{ "name": "trace_affected", "arguments": { "ref": "N-7fe707" } }
```

```json
{ "name": "hint_list", "arguments": { "kind": ["relation.outdated"] } }
```

```json
{ "name": "hint_confirm", "arguments": { "target": "N-7fe707" } }
```

```json
{ "name": "element_supersede", "arguments": { "ref": "SR-5e1d0a", "status": "obsolete", "successor": "SR-62fb87" } }
```

The reference has every option of [element.setStatus](/reference/commands/element-set-status/), [element.bulkUpdate](/reference/commands/element-bulk-update/), [trace.affected](/reference/commands/trace-affected/), [hint.list](/reference/commands/hint-list/), [hint.confirm](/reference/commands/hint-confirm/) and [element.supersede](/reference/commands/element-supersede/).
