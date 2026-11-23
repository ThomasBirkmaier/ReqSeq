---
title: Review and approve a requirement
description: Set the status of requirements, review them after a parent changed, and supersede an approved requirement by a new one.
---

The status of an element is one of the statuses its type has in the metamodel. In the standard model these are `draft` (the status of a new element), `approved` and `obsolete`, which the metamodel marks invalid. ReqSeq never sets a status itself: only you do, and a change to an approved element leaves it approved. Instead, ReqSeq marks the relations that point to the changed element as outdated, and those hints tell you what to review.

ReqSeq never deletes an element. You supersede an approved one: it gets an invalid status, and a successor, if there is one, can name it with `supersedes`, so the chain and its evidence stay traceable. A draft that was never approved and is in no baseline you can [remove](/how-to/remove-a-draft/).

## Web UI

The web UI sets a status only on **Changes since**, named after the baseline, so a workspace needs a baseline first ([Take a baseline](/how-to/take-a-baseline/)); before it, use the CLI, the API or MCP.

1. Open **Changes since** in the rail and click an element: its difference shows word by word, with **Approve**, **Set status** and **Supersede**. Each writes only after a confirmation that names the elements and the status.
2. To decide on several at once, tick them in the list: **Approve**, **Set status** and **Change a property** act on all of them. **Change a property** first shows what ReqSeq would change, and writes nothing before you confirm.
3. Before you change an element, its **Impact** tab lists the elements that trace to it.
4. After the change, **Links to review** on the overview lists the requirements whose link to the need is outdated. Review each; where it is listed on **Changes since**, **Mark links as reviewed** on its difference clears the mark.
5. To supersede an element, create its successor with **New element**. Then, where the old one is listed on **Changes since**, click **Supersede** on its difference, choose the status, and name the successor.

## CLI

Start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed"
```

```text title="Output"
Created Need N-7fe707; 1 file written.
N-7fe707  draft  See the wind speed  [validation: open]
...
```

```sh
reqseq element create system-requirement "Show the wind speed" --relations derives-from=N-7fe707
```

```text title="Output"
Created System Requirement SR-c67baa; 1 file written; 2 problems.
SR-c67baa  draft  Show the wind speed  [verification: core open]
...
```

```sh
reqseq element create system-requirement "Warn of gusts" --relations derives-from=N-7fe707
```

```text title="Output"
Created System Requirement SR-5e1d0a; 1 file written; 2 problems.
SR-5e1d0a  draft  Warn of gusts  [verification: core open]
...
```

`element bulk-update` changes one property, never the status, for every element of a selection. Without `--confirm` it only shows what it would change:

```sh
reqseq element bulk-update verification-method set --where-type system-requirement --input '{"value":"test"}'
```

```text title="Output"
Preview: the change of property verification-method would change 2 elements, nothing written.
applied: false
count: 2
...
```

With `--confirm`, `--expected` refuses the write when the count is no longer that of the preview. `--plan` with the preview's `plan` is stricter: it refuses unless the same files get the same bytes.

```sh
reqseq element bulk-update verification-method set --where-type system-requirement --input '{"value":"test"}' --confirm --expected 2
```

```text title="Output"
Changed property verification-method of 2 elements; 2 files written.
applied: true
count: 2
...
```

`element set-status` takes several elements at once:

```sh
reqseq element set-status approved --refs N-7fe707 --refs SR-c67baa --refs SR-5e1d0a
```

```text title="Output"
Set the status of 3 elements to approved; 4 problems.
files:
...
warning  element.missing-required  ...
warning  element.missing-required  ...
warning  element.missing-required  ...
warning  element.missing-required  ...
```

The status is set even where a required property has no value; the output names each one.

Before you change the need, see what traces to it:

```sh
reqseq trace affected N-7fe707
```

```text title="Output"
2 elements are affected by a change of N-7fe707.
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
Found 2 open hints.
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
Confirmed 2 hints; 2 files written.
confirmed:
...
No problems.
```

To supersede the gust warning, create its successor, then supersede the old one:

```sh
reqseq element create system-requirement "Warn of gusts and squalls" --relations derives-from=N-7fe707
```

```text title="Output"
Created System Requirement SR-62fb87; 1 file written; 2 problems.
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

The answer is the command's output as JSON, as `--json` gives it.

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
