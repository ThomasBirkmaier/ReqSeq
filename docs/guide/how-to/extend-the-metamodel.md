---
title: Extend the metamodel
description: Add an element type, a relation kind and a readable identifier of your own next to the standard model.
sidebar:
  order: 5
---

The metamodel says which element types, properties, relation kinds and statuses a workspace has. `workspace init` writes the standard model to `metamodel/standard-model.yaml`; ReqSeq reads every `*.yaml` file directly in that folder, in name order, and merges them; subfolders and hidden files are not read, and a `*.yml` file only gives a warning. So you extend the model with a file of your own next to it, and keep the standard model as it is. The fields are on the [metamodel format](/reference/formats/metamodel/) page.

This page adds the type `component`, a property `component-id` with the meaning `identifier`, so a component can be named by a readable ID such as `C-ANEMO`, and the relation kind `allocated-to` from a system requirement to a component. A key must be new: a key used twice, also between a property and a relation kind, is an error, and the workspace is then read-only until it is fixed. The one change your own file cannot make is a new property on a type of the standard model: for that, add the key to that type's `properties` in `standard-model.yaml`.

## Which properties count to the version

Set `content: true` on every property whose change must give the element a new version, so that its evidence and the relations pointing to it become outdated. The version is computed from the text, the embedded images and the properties marked this way only. A property without `content: true`, such as the definition of a glossary term or an internal note in a type of your own, changes no version when its value changes, and two elements with the same text and the same marked values have the same version. The element text always counts. In the standard model, acceptance criteria, requirement type, validity and the validation criteria of a need count; title, status, package, rationale, priority and statement do not. The statement is the supplier's statement on an imported requirement (exported with `reqif export --statements`), not the requirement itself: write the requirement into the text. `workspace check` warns about a requirement with a statement but no text (`element.statement-without-text`).

```yaml title="metamodel/glossary.yaml"
reqseq-metamodel: 1
types:
  - key: glossary-term
    name: Glossary Term
    prefix: G
    properties: [title, definition]
    required: [title, definition]
properties:
  - key: definition
    name: Definition
    kind: text
    content: true
```

`reqseq metamodel get` shows `content: true` or `content: false` for every property, and the app's metamodel text (**Show metamodel**, then Ctrl+T, ⌘T on macOS) marks those that count with "counts to version".

All repositories of a workspace are read with the workspace's metamodel; a repository that is also a workspace of its own must use the same metamodel, or its elements get other versions. `workspace check` warns when they differ (`workspace.metamodel-mismatch`).

## App

Not possible in the app: the metamodel is a file you edit in a text editor. The app reads the change when you save it; **Show metamodel** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS) shows the types and relation kinds with their problems, and **Check workspace** lists what does not fit the new model. Then create a component with **Create element** and link it with **Create relation**.

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
```

Write the file `metamodel/components.yaml`:

```yaml title="metamodel/components.yaml"
reqseq-metamodel: 1
types:
  - key: component
    name: Component
    description: "A part of the system that requirements are allocated to."
    prefix: C
    properties: [title, component-id]
    required: [title]
properties:
  - key: component-id
    name: Component ID
    kind: text
    meaning: identifier
relations:
  - key: allocated-to
    name: Allocated to
    inverse-name: Allocates
    source-types: [system-requirement]
    target-types: [component]
```

```sh
reqseq workspace check
```

```text title="Output"
ok: true
checkedElements: 0
No problems.
```

```sh
reqseq element create component "Anemometer" --input '{"properties":{"component-id":"C-ANEMO"}}'
reqseq element create system-requirement "Show the wind speed" --text "The station must show the wind speed in knots."
```

```text title="Output"
SR-c67baa  draft  Show the wind speed
...
```

The identifier names the component in every command that takes an element:

```sh
reqseq relation add SR-c67baa allocated-to C-ANEMO
reqseq element get SR-c67baa
```

```text title="Output"
...
  relations:
    - -> allocated-to  C-f9ecfb (C-ANEMO)  Anemometer
...
```

### Decisions as parents

The trace chain follows every relation kind with the meaning `derivation`. In the standard model `based-on` has none, so a requirement based on a decision has no parent: the chain marks it `[gap: no parent]` and `workspace check` reports it (`trace.no-parent`). If your project wants decisions as parents, give a relation kind the meaning `derivation`: either `based-on` itself, with `meaning: derivation` added to its entry in `standard-model.yaml`, or a kind of your own in your file:

```yaml title="metamodel/origins.yaml"
reqseq-metamodel: 1
relations:
  - key: decided-by
    name: Decided by
    inverse-name: Decides
    source-types: [system-requirement]
    target-types: [decision]
    meaning: derivation
```

A requirement with `decided-by` then has the decision as its parent in `trace chain`, and `workspace check` no longer reports it.

### Limit the number of relations

A relation kind can say how many relations of it an element may or must have to elements of a type, with `limits`: each entry names a `target-type`, at least one of `min` and `max`, and optionally a `source-type` (without it, the limit applies to the kind's `source-types`, or to every type when the kind has none; with it, only to the types the kind's `source-types` also allow). Subtypes count on both sides. For example, a system requirement realizes at most one component and at least one need:

```yaml title="metamodel/limits.yaml"
reqseq-metamodel: 1
relations:
  - key: realizes
    name: Realizes
    inverse-name: Realized by
    source-types: [system-requirement]
    target-types: [need, component]
    limits:
      - { target-type: component, max: 1 }
      - { source-type: system-requirement, target-type: need, min: 1 }
```

`workspace check` and `hint list` then report an element with more relations than `max` (`relation.too-many`) or fewer than `min` (`relation.too-few`) as a hint with the element, the relation kind, the target type, the count and the limit. `element get` shows the hints of the element too. Nothing is refused: `relation add` saves a relation over the limit and returns the `relation.too-many` hint. Only relations whose target is found count, and while a target lies in a repository that is not on this machine, no `relation.too-few` is given. A relation kind without `limits` allows any number, also none.

## API

Write the file as above, then start the API in the workspace with `reqseq serve api`, and send each command with the token of `api.json` as `Authorization: Bearer <token>`:

```http
POST /v1/commands/metamodel.get

{}
```

```http
POST /v1/commands/element.create

{ "type": "component", "title": "Anemometer", "properties": { "component-id": "C-ANEMO" } }
```

```http
POST /v1/commands/relation.add

{ "source": "SR-c67baa", "kind": "allocated-to", "target": "C-ANEMO" }
```

## MCP

Write the file as above. An agent connected to `reqseq mcp` then calls the same commands as tools:

```json
{ "name": "metamodel_get", "arguments": {} }
```

```json
{ "name": "element_create", "arguments": { "type": "component", "title": "Anemometer", "properties": { "component-id": "C-ANEMO" } } }
```

```json
{ "name": "relation_add", "arguments": { "source": "SR-c67baa", "kind": "allocated-to", "target": "C-ANEMO" } }
```

The reference has every option of [metamodel.get](/reference/commands/metamodel-get/), [element.create](/reference/commands/element-create/) and [relation.add](/reference/commands/relation-add/).
