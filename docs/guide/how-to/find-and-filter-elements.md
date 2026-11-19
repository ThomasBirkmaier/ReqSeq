---
title: Find and filter elements
description: Search the elements in full text, narrow a list step by step, save a filter as a file, and group and sort a list.
sidebar:
  order: 7
---

The search finds words in titles, texts, property values, type and status names and IDs, in any case, despite a typo, the best hits first; typed exactly, 4 letters also match inside words (SR-221); quoted words only as a phrase. A synonym or translation (D-059) also finds the other designations of its element, after direct hits (SR-220). A filter keeps the elements that meet its conditions on type, status, package, properties and relations, combined with and, or and not. A saved filter is a YAML file in the repository, so everyone gets the same elements. Grouping and sorting change no file, unless you save the list as a perspective, or its sort with a saved filter.

## App

1. **Go to element or buffer** (Ctrl+P, ⌘P on macOS) finds an element by short ID or title words; Enter opens it.
2. To search, run **Search elements** (Ctrl+Shift+F, ⌘⇧F) and type. Ctrl+Enter (⌘↩) picks the fields. Open a hit with arrows and Enter, or all hits with Enter alone.
3. **List all elements** (Ctrl+K L, ⌘K L) opens the whole list. Narrow it with “Filter list” (Ctrl+K F, ⌘K F): pick a kind, then a value, adding one step; “Type” takes several, matching any, until “Take N types”. Escape goes back a step. “Clear list filter” takes back the last step, “Clear all list filters” all, except a perspective’s own selection.
4. “Sort list” (Ctrl+K S) orders the list by a key, ascending or descending, or as derivation tree. “Group list” offers type, status, package and properties with values to choose from; “Ungroup list” ends it. Search hits take filters and groups and keep their order. A right-click outside the rows offers most of these.
5. To list every element with a value of the open element, put the cursor on the value and press Ctrl+Shift+Enter (⌘⇧↩) for “List elements with this value”, or Ctrl+click it (⌘Click).
6. Elements in a status the metamodel marks invalid (`obsolete` in the standard model) stand at the end of a list in the closed section “Folded statuses”; “Fold status in lists” chooses the statuses that fold on this computer.
7. Ctrl+K V (⌘K V) opens a perspective. “Save list as perspective” saves a list’s steps, grouping and sort, “Save list as saved filter” its steps and a sort chosen or saved with the perspective; **New perspective** in the [command prompt](/concepts/the-app/) asks name, condition, grouping, sort; the modeline says “modified” once a step, sort or grouping of a perspective’s buffer changes.
8. **New saved filter** in the command prompt (Ctrl+Shift+P, ⌘⇧P) asks a name, then conditions, all holding; `{` starts JSON. Then “Next: sort” and “Save”.

## CLI

The commands start in a new workspace; use your own short IDs. `--set topic=…` gives each element a topic.

```sh
reqseq workspace init . "Weather station"
reqseq element create need "See the wind speed" --text "As a sailor, I want to see the wind speed before I leave the harbour." --set topic=wind
```

```text title="Output"
Created Need N-7fe707; 1 file written.
N-7fe707  draft  See the wind speed  [validation: open]
...
```

```sh
reqseq element create system-requirement "Show the wind speed" --text "The station must show the wind speed in knots." --set topic=wind --relations derives-from=N-7fe707
```

```text title="Output"
Created System Requirement SR-c67baa; 1 file written; 2 problems.
SR-c67baa  draft  Show the wind speed  [verification: core open]
...
```

```sh
reqseq element create system-requirement "Warn of gusts" --text "The station must warn when a gust exceeds 25 knots." --set topic=wind --relations derives-from=N-7fe707
```

```text title="Output"
Created System Requirement SR-5e1d0a; 1 file written; 2 problems.
SR-5e1d0a  draft  Warn of gusts  [verification: core open]
...
```

```sh
reqseq element create system-requirement "Show the temperature" --text "The station must show the air temperature in degrees Celsius." --set topic=temperature
```

```text title="Output"
Created System Requirement SR-41c165; 1 file written; 3 problems.
SR-41c165  draft  Show the temperature  [verification: core open]
...
```

The search finds the word despite a typo:

```sh
reqseq element search temprature
```

```text title="Output"
Found 1 hit for the query temprature.
hits:
  SR-41c165  draft  Show the temperature
    text: The station must show the air temperature in degrees Celsius.
total: 1
```

`--fields` searches only fields `element search-fields` lists:

```sh
reqseq element search-fields
```

```text title="Output"
A search can be restricted to 18 fields.
fields:
  - key: title
    name: Title
  - key: text
    name: Text
  - key: id
    name: IDs
  - key: properties
    name: All properties
...
```

```sh
reqseq element search wind --fields title
```

```text title="Output"
Found 2 hits for the query wind.
hits:
  N-7fe707  draft  See the wind speed
  SR-c67baa  draft  Show the wind speed
total: 2
```

```sh
reqseq element search '"show the wind"'   # a phrase, in single quotes for the shell
```

```text title="Output"
Found 1 hit for the query "show the wind".
hits:
  SR-c67baa  draft  Show the wind speed
    text: The station must show the wind speed in knots.
total: 1
```

`--where-type` and `--where-status` filter on type and status; `--where` takes any condition as JSON. System requirements without a parent:

```sh
reqseq element list --where-type system-requirement --where '{"relation":{"meaning":"derivation","direction":"up"},"exists":false}'
```

```text title="Output"
Listed 1 element.
elements:
  SR-41c165  draft  Show the temperature
total: 1
```

A saved filter is a file in `filters/`; `--sort` sets the order of its lists:

```sh
reqseq filter save "Wind requirements" --where-type system-requirement --where '{"property":"topic","op":"eq","value":"wind"}' --sort title
```

```text title="Output"
Saved filter Wind requirements; 1 file written.
files:
  filters/wind-requirements.yaml
No problems.
```

```sh
reqseq filter list
```

```text title="Output"
Found 1 saved filter.
filters:
  - name: Wind requirements
    file: filters/wind-requirements.yaml
...
```

```sh
reqseq element list --filter "Wind requirements"
```

```text title="Output"
Listed 2 elements.
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
Found 2 hits for the query knots.
hits:
  SR-c67baa  draft  Show the wind speed
    text: The station must show the wind speed in knots.
  SR-5e1d0a  draft  Warn of gusts
    text: The station must warn when a gust exceeds 25 knots.
total: 2
```

`--group` heads each group of a list or hits with its value and count:

```sh
reqseq element list --group topic --sort title
```

```text title="Output"
Listed 4 rows.
elements:
  temperature · 1
    SR-41c165  draft  Show the temperature
  wind · 3
    N-7fe707  draft  See the wind speed
    SR-c67baa  draft  Show the wind speed
    SR-5e1d0a  draft  Warn of gusts
total: 4
```

`element facets` counts the types, statuses and property values a filter or group can take. Folding changes only what the app displays; the CLI leaves those elements out with `{"not":{"invalid":true}}`.

## API

With the workspace's [local API](/concepts/cli-api-and-mcp/#api) running, and its token:

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

Over `reqseq mcp`, agents call the same commands as tools:

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

The reference has every option and condition of [element.search](/reference/commands/element-search/), [element.list](/reference/commands/element-list/), [filter.save](/reference/commands/filter-save/), [filter.rename](/reference/commands/filter-rename/), [filter.delete](/reference/commands/filter-delete/), [filter.list](/reference/commands/filter-list/) and [element.facets](/reference/commands/element-facets/); a saved filter's file is in [Formats](/reference/formats/filter/).
