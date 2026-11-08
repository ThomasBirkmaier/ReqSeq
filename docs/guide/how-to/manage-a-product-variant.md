---
title: Manage a product variant
description: Set up a variant on the shared core, replace or exclude core requirements for it, and see its view, its difference to the core and the core changes it has to follow.
sidebar:
  order: 10
---

A variant is an element of the type Variant, in the same workspace as the core. A requirement without the property Validity belongs to the core and applies in every variant; one with Validity applies only in the variants it names. A variant changes the core in two ways:

- Replace: a requirement with the variant in its Validity and the relation Replaces to a core requirement takes that requirement's place in the variant. The relation stores the version of the core requirement.
- Exclude: `variant.exclude` writes the core requirement into the variant's file, under Excludes; the core requirement's file stays as it is. Only core requirements can be excluded.

The view of a variant holds the core requirements it neither excludes nor replaces, plus its own; needs, packages and other types without Validity are in every view. When a replaced core requirement changes, the replacing requirement gets the hint `variant.core-changed`. When a core requirement the variant takes over changes after the variant's newest baseline, or comes into its view, the variant gets `variant.core-changed-since-baseline` or `variant.core-new-since-baseline`; only a new baseline of the variant settles those.

## App

1. Create the variant with **Create element** (Ctrl+K E, ⌘K E on macOS), type Variant.
2. In the element buffer of the variant's own requirement, add Validity with "Add property" (Ctrl+Alt+A, ⌥⌘A) and choose the variant, then run **Save element** (Ctrl+S, ⌘S). **Create relation** (Ctrl+K R, ⌘K R) with the kind Replaces and the core requirement makes it a replacement.
3. Run **Exclude requirements from variant** in the command prompt (Ctrl+Shift+P, ⌘⇧P); it asks the variant and the requirements. To take an exclusion back, press Ctrl+Enter (⌘↩) after the requirements and answer `undo` with yes.
4. "Choose view" in the command prompt switches the window to all elements, the core or a variant; the modeline then says `view: Coastal station`, and lists, search, chains and coverage hold for that view.
5. **Show variant difference** lists the added, replaced and excluded requirements; Enter on a replaced one shows the core requirement and its replacement side by side.
6. The page of a replacing requirement shows the hint when its core requirement changed; **Confirm hints** (Ctrl+K H, ⌘K H) takes over the new version. **List hints**, with Ctrl+Enter (⌘↩) and `variant`, lists the hints of the variant's view, and the variant's page lists the core changes since its newest baseline.
7. For a baseline of the variant, run **Create baseline** on **List all elements** in its view.

## CLI

In your workspace, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create system-requirement "Show the wind speed"
reqseq element create system-requirement "Show the temperature"
```

```text title="Output"
SR-a3e1d0  draft  Show the temperature  [verification: core open]
...
```

```sh
reqseq element create variant "Mountain station"
reqseq element create variant "Coastal station"
```

```text title="Output"
VAR-f23826  draft  Coastal station
...
```

```sh
reqseq element list --where-type system-requirement --where-type variant --sort title
```

```text title="Output"
elements:
  VAR-f23826  draft  Coastal station
  VAR-5c7b92  draft  Mountain station
  SR-a3e1d0  draft  Show the temperature
  SR-c67baa  draft  Show the wind speed
total: 4
```

The coastal station shows the wind in Beaufort instead, and the mountain station has no thermometer:

```sh
reqseq element create system-requirement "Show the wind speed in Beaufort" --set 'validity=["VAR-f23826"]' --relations replaces=SR-c67baa
reqseq variant exclude VAR-5c7b92 --refs SR-a3e1d0
```

```text title="Output"
files:
  variant/VAR-cf5b215c7b92.md
No problems.
```

`--view` (a variant, or `core`) restricts a list, search, chain, coverage or export to that view:

```sh
reqseq element list --view VAR-f23826 --where-type system-requirement --sort title
```

```text title="Output"
elements:
  SR-a3e1d0  draft  Show the temperature
  SR-6d2406  draft  Show the wind speed in Beaufort
total: 2
```

```sh
reqseq variant diff VAR-f23826
```

```text title="Output"
added: none
replaced:
  - core: SR-c67baa  Show the wind speed
    replacement: SR-6d2406  Show the wind speed in Beaufort
excluded: none
```

`element get SR-c67baa` names the variant that replaces it under `replacedBy`, and `element get SR-a3e1d0` the one that excludes it under `excludedBy`. A change to the content of the core requirement, not only its title, gives the hint:

```sh
reqseq element update SR-c67baa --set requirement-type=functional
reqseq hint list --variant VAR-f23826 --kind variant.core-changed
```

```text title="Output"
hints:
  SR-6d2406 → SR-c67baa  variant.core-changed  Core requirement System Requirement SR-c67baa, which System Requirement SR-6d2406 replaces, has changed since ...
total: 1
```

After adapting the replacement, confirm the hint; `--expected` is the number of hints you reviewed:

```sh
reqseq hint confirm --ref SR-6d2406 --kind variant.core-changed --expected 1
reqseq variant exclude VAR-5c7b92 --refs SR-a3e1d0 --undo
```

The second command takes the exclusion back. After a commit, `reqseq baseline create "Coastal 1" --view VAR-f23826` writes a baseline of the variant. Later, `reqseq hint list --ref VAR-f23826` lists each core requirement that changed since then, with both versions, or is new in the view.

## API

With `reqseq serve api` running in the workspace, and the token of `api.json` as `Authorization: Bearer <token>`:

```http
POST /v1/commands/element.create

{ "type": "system-requirement", "title": "Show the wind speed in Beaufort", "properties": { "validity": ["VAR-f23826"] }, "relations": { "replaces": "SR-c67baa" } }
```

```http
POST /v1/commands/variant.exclude

{ "variant": "VAR-5c7b92", "refs": ["SR-a3e1d0"] }
```

```http
POST /v1/commands/element.list

{ "selection": { "view": "VAR-f23826" } }
```

```http
POST /v1/commands/variant.diff

{ "variant": "VAR-f23826" }
```

```http
POST /v1/commands/hint.list

{ "variant": "VAR-f23826" }
```

```http
POST /v1/commands/hint.confirm

{ "ref": "SR-6d2406", "kind": ["variant.core-changed"], "expected": 1 }
```

```http
POST /v1/commands/baseline.create

{ "name": "Coastal 1", "selection": { "view": "VAR-f23826" } }
```

`"undo": true` in `variant.exclude` takes an exclusion back.

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools:

```json
{ "name": "element_create", "arguments": { "type": "system-requirement", "title": "Show the wind speed in Beaufort", "properties": { "validity": ["VAR-f23826"] }, "relations": { "replaces": "SR-c67baa" } } }
```

```json
{ "name": "variant_exclude", "arguments": { "variant": "VAR-5c7b92", "refs": ["SR-a3e1d0"] } }
```

```json
{ "name": "element_list", "arguments": { "selection": { "view": "VAR-f23826" } } }
```

```json
{ "name": "variant_diff", "arguments": { "variant": "VAR-f23826" } }
```

```json
{ "name": "hint_list", "arguments": { "variant": "VAR-f23826" } }
```

```json
{ "name": "hint_confirm", "arguments": { "ref": "SR-6d2406", "kind": ["variant.core-changed"], "expected": 1 } }
```

```json
{ "name": "baseline_create", "arguments": { "name": "Coastal 1", "selection": { "view": "VAR-f23826" } } }
```

The reference has every option of [variant.exclude](/reference/commands/variant-exclude/), [variant.diff](/reference/commands/variant-diff/), [hint.list](/reference/commands/hint-list/), [hint.confirm](/reference/commands/hint-confirm/) and [baseline.create](/reference/commands/baseline-create/).
