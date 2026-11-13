---
title: Find and filter elements
description: Search the elements in full text, narrow a list step by step, save a filter as a file, and group and sort a list.
sidebar:
  order: 7
---

The search finds words in titles, texts, property values, type and status names and IDs, in any case and despite a typo, the best hits first. A filter keeps the elements that meet its conditions on type, status, package, properties and relations, combined with and, or and not. A saved filter is a YAML file in the repository, so everyone gets the same elements by its name. Grouping and sorting change no file, unless you save the list as a perspective.

## App

1. To open one element, press Ctrl+P (⌘P on macOS) for **Go to element or buffer**, type its short ID or words of its title, and press Enter.
2. To search, run **Search elements** (Ctrl+Shift+F, ⌘⇧F) and type. Open a hit with the arrow keys and Enter, or all hits in a buffer with Enter alone.
3. **List all elements** (Ctrl+K L, ⌘K L) opens the whole list. Narrow it step by step with “Filter list by type” (Ctrl+K F), “Filter list by status”, “Filter list by property”, “Filter list by text search” and “Filter list by saved filter”. “Clear list filter” takes back the last step, “Clear all list filters” all, except a perspective’s own selection.
4. “Sort list” (Ctrl+K S) orders the list, for example by title or as the derivation tree. “Group list” offers type, status, package and the properties with values to choose from; “Ungroup list” ends it. Search hits take filters and groups too and keep their order. A right-click outside the rows of a list offers most of these.
5. To list every element with a value of the open element, put the cursor on the value and press Ctrl+Shift+Enter (⌘⇧↩) for “List elements with this value”, or Ctrl+click it (⌘Click).
6. Elements in a status the metamodel marks invalid (`obsolete` in the standard model) stand at the end of a list in the closed section “Folded statuses”; click its head or press Enter on it to open it. “Fold status in lists” chooses the statuses that fold, for you on this computer.
7. Ctrl+K V (⌘K V) opens a perspective in its own buffer. “Save list as perspective” saves a list’s filter steps, grouping and sort under a name; the modeline says “modified” once a step, sort or grouping of the perspective’s buffer changes.
8. To save a filter, run **Save filter** in the [command prompt](/concepts/the-app/) (Ctrl+Shift+P, ⌘⇧P), name it, and pick each condition as a kind and value; all must hold. On a filtered list, the first hit takes its steps. `{` starts JSON. **List saved filters** lists them.

## CLI

The commands start from a new workspace; in yours, use your own short IDs. `--set topic=…` gives each element a topic.

```sh
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed" --text "As a sailor, I want to see the wind speed before I leave the harbour." --set topic=wind
```

```text title="Output"
N-7fe707  draft  See the wind speed  [validation: open]
...
```

```sh
reqseq element create system-requirement "Show the wind speed" --text "The station must show the wind speed in knots." --set topic=wind --relations derives-from=N-7fe707
```

```text title="Output"
SR-c67baa  draft  Show the wind speed  [verification: core open]
...
```

```sh
reqseq element create system-requirement "Warn of gusts" --text "The station must warn when a gust exceeds 25 knots." --set topic=wind --relations derives-from=N-7fe707
```

```text title="Output"
SR-5e1d0a  draft  Warn of gusts  [verification: core open]
...
```

```sh
reqseq element create system-requirement "Show the temperature" --text "The station must show the air temperature in degrees Celsius." --set topic=temperature
```

```text title="Output"
SR-41c165  draft  Show the temperature  [verification: core open]
...
```

The search finds the word despite a typo, with the line around it:

```sh
reqseq element search temprature
```

```text title="Output"
hits:
  SR-41c165  draft  Show the temperature
    text: The station must show the air temperature in degrees Celsius.
total: 1
```

`--where-type` and `--where-status` filter on type and status; `--where` takes any condition as JSON. Here: the system requirements without a parent:

```sh
reqseq element list --where-type system-requirement --where '{"relation":{"meaning":"derivation","direction":"up"},"exists":false}'
```

```text title="Output"
elements:
  SR-41c165  draft  Show the temperature
total: 1
```

A filter saved by name is a file in `filters/`; `--sort` sets the order its lists take:

```sh
reqseq filter save "Wind requirements" --where-type system-requirement --where '{"property":"topic","op":"eq","value":"wind"}' --sort title
```

```text title="Output"
files:
  filters/wind-requirements.yaml
No problems.
```

```sh
reqseq filter list
```

```text title="Output"
filters:
  - name: Wind requirements
    file: filters/wind-requirements.yaml
...
```

```sh
reqseq element list --filter "Wind requirements"
```

```text title="Output"
elements:
  SR-c67baa  draft  Show the wind speed
  SR-5e1d0a  draft  Warn of gusts
total: 2
```

The same name limits a search:

```sh
reqseq element search knots --filter "Wind requirements"
```

```text title="Output"
hits:
  SR-c67baa  draft  Show the wind speed
    text: The station must show the wind speed in knots.
  SR-5e1d0a  draft  Warn of gusts
    text: The station must warn when a gust exceeds 25 knots.
total: 2
```

`--group` heads each group of a list or of hits with its value and count:

```sh
reqseq element list --group topic --sort title
```

```text title="Output"
elements:
  temperature · 1
    SR-41c165  draft  Show the temperature
  wind · 3
    N-7fe707  draft  See the wind speed
    SR-c67baa  draft  Show the wind speed
    SR-5e1d0a  draft  Warn of gusts
total: 4
```

`element facets` counts the types, statuses and property values a filter or group can take. Folding is a view of the app; the CLI leaves those elements out with `{"not":{"invalid":true}}`.

## API

With the [local API](/concepts/cli-api-and-mcp/#api) running in the workspace, and its token:

```http
POST /v1/commands/filter.save

{ "name": "Wind requirements", "where": { "all": [{ "type": ["system-requirement"] }, { "property": "topic", "op": "eq", "value": "wind" }] }, "sort": [{ "by": "title" }] }
```

```http
POST /v1/commands/filter.list

{}
```

```http
POST /v1/commands/element.search

{ "query": "knots", "selection": { "filter": "Wind requirements" } }
```

```http
POST /v1/commands/element.list

{ "selection": { "filter": "Wind requirements" }, "group": "status" }
```

```http
POST /v1/commands/element.facets

{ "selection": { "where": { "type": ["system-requirement"] } } }
```

## MCP

An agent connected to `reqseq mcp` calls the same commands as tools:

```json
{
  "name": "filter_save",
  "arguments": {
    "name": "Wind requirements",
    "where": { "all": [{ "type": ["system-requirement"] }, { "property": "topic", "op": "eq", "value": "wind" }] },
    "sort": [{ "by": "title" }]
  }
}
```

```json
{ "name": "filter_list", "arguments": {} }
```

```json
{ "name": "element_search", "arguments": { "query": "knots", "selection": { "filter": "Wind requirements" } } }
```

```json
{ "name": "element_list", "arguments": { "selection": { "filter": "Wind requirements" }, "group": "status" } }
```

```json
{ "name": "element_facets", "arguments": { "selection": { "where": { "type": ["system-requirement"] } } } }
```

The reference has every option and condition of [element.search](/reference/commands/element-search/), [element.list](/reference/commands/element-list/), [filter.save](/reference/commands/filter-save/), [filter.list](/reference/commands/filter-list/) and [element.facets](/reference/commands/element-facets/); the file of a saved filter is in [Formats](/reference/formats/filter/).
