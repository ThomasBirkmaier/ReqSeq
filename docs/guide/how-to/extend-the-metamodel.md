---
title: Extend the metamodel
description: Add an element type, a relation kind and a readable identifier of your own next to the standard model.
sidebar:
  order: 5
---

The metamodel says which element types, properties, relation kinds and statuses a workspace has. `workspace init` writes the standard model to `metamodel/standard-model.yaml`; ReqSeq reads every `*.yaml` file directly in that folder, in name order, and merges them; subfolders and hidden files are not read, and a `*.yml` file only gives a warning. So you extend the model with a file of your own next to it, and keep the standard model as it is. The fields are on the [metamodel format](/reference/formats/metamodel/) page.

This page adds the type `component`, a property `component-id` with the meaning `identifier`, so a component can be named by a readable ID such as `C-ANEMO`, and the relation kind `allocated-to` from a system requirement to a component. A key must be new: a key used twice, also between a property and a relation kind, is an error, and the workspace is then read-only until it is fixed. The one change your own file cannot make is a new property on a type of the standard model: for that, add the key to that type's `properties` in `standard-model.yaml`.

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
