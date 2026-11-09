---
title: Choose what counts to the version
description: Mark the properties whose change gives an element a new version, so that its evidence and the relations to it become outdated.
sidebar:
  order: 5.1
---

Set `content: true` on every property whose change must give the element a new version, so that its evidence and the relations pointing to it become outdated. The version is computed from the text, the embedded images and the properties marked this way only. A property without `content: true`, such as the definition of a glossary term or an internal note in a type of your own, changes no version when its value changes, and two elements with the same text and the same marked values have the same version. The element text always counts. A marked property counts only on the types that list it in `properties`: a value under another type changes no version. In the standard model, acceptance criteria, requirement type, validity and the validation criteria of a need count; the others do not, for example title, status, package, rationale, priority, emergent, verification method, topic, statement and the origin properties of an import (source, source identifier, import date, delivery, import version). The statement is the supplier's statement on an imported requirement (exported with `reqif export --statements`), not the requirement itself: write the requirement into the text. `workspace check` warns about a requirement with a statement but no text (`element.statement-without-text`).

For a type of your own, set it in your metamodel file next to the standard model ([Extend the metamodel](/how-to/extend-the-metamodel/)):

```yaml
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

Not possible in the app: the metamodel is a file you edit in a text editor. **Show metamodel** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS), then Ctrl+T (⌘T on macOS), shows the metamodel as text and marks the properties that count with "counts to version".

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
```

With the file above as `metamodel/glossary.yaml`:

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

```sh
reqseq workspace check
```

```text title="Output"
ok: true
checkedElements: 0
No problems.
```

`reqseq metamodel get` then lists `definition` with `content: true`.

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/metamodel.get

{}
```

## MCP

```json
{ "name": "metamodel_get", "arguments": {} }
```

The reference has every option of [metamodel.get](/reference/commands/metamodel-get/), and the [metamodel format](/reference/formats/metamodel/) every field.
