---
title: Limit relations and list entries
description: Say in the metamodel how many relations of a kind an element must or may have, and how many entries a list property may hold.
sidebar:
  order: 5.2
---

A relation kind can say how many relations of it an element may or must have to elements of a type, with `limits`: each entry names a `target-type`, at least one of `min` and `max`, and optionally a `source-type` (without it, the limit applies to the kind's `source-types`, or to every type when the kind has none; with it, only to the types the kind's `source-types` also allow). Subtypes count on both sides. For example, a system requirement realizes at least one and at most two needs:

```yaml
reqseq-metamodel: 1
relations:
  - key: realizes
    name: Realizes
    inverse-name: Realized by
    source-types: [system-requirement]
    target-types: [need]
    limits:
      - { source-type: system-requirement, target-type: need, min: 1, max: 2 }
```

`workspace check` and `hint list` then report an element with more relations than `max` (`relation.too-many`) or fewer than `min` (`relation.too-few`) as a hint with the element, the relation kind, the target type, the count and the limit. `element get` shows the hints of the element too. Nothing is refused: `relation add` saves a relation over the limit and returns the `relation.too-many` hint. Only relations whose target is found count, and while a target lies in a repository that is not on this machine, no `relation.too-few` is given. A relation kind without `limits` allows any number, also none.

## Limit the entries of a list

A property with `many: true` that holds no relations can say how many entries it may have, with `max-items`. For example, a system requirement has at most three acceptance criteria: add `max-items: 3` to the `acceptance-criteria` entry in `standard-model.yaml` (a second definition of the same key in your own file would be a metamodel error):

```yaml
properties:
  - key: acceptance-criteria
    # ... the entry as it is, plus:
    max-items: 3
```

`workspace check` and `hint list` then report an element with more entries (`element.too-many-items`) as a hint with the element, the property, the count and the limit, and `element get` shows it at the element. Nothing is refused: the entries are kept. A property without `max-items` allows any number. `max-items` on a property without `many: true` or of kind `relation` is a metamodel error.

## App

Not possible in the app: the metamodel is a file you edit in a text editor. The app reads the change when you save it; **Check workspace** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS) and the element itself show the hints.

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
```

A system requirement must realize at least one need:

```yaml title="metamodel/limits.yaml"
reqseq-metamodel: 1
relations:
  - key: realizes
    name: Realizes
    inverse-name: Realized by
    source-types: [system-requirement]
    target-types: [need]
    limits:
      - { target-type: need, min: 1 }
```

```sh
reqseq element create system-requirement "Show the wind speed"
reqseq hint list --kind relation.too-few
```

```text title="Output"
kinds:
  - code: relation.too-few
    count: 1
hints:
  SR-c67baa  Show the wind speed  relation.too-few  System Requirement SR-c67baa has 0 relations Realizes (realizes) to Need (need); at least 1
total: 1
```

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/hint.list

{ "kind": "relation.too-few" }
```

## MCP

```json
{ "name": "hint_list", "arguments": { "kind": "relation.too-few" } }
```

The reference has every option of [hint.list](/reference/commands/hint-list/) and [workspace.check](/reference/commands/workspace-check/), and the [metamodel format](/reference/formats/metamodel/) every field.
