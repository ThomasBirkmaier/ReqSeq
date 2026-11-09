---
title: Record evidence for a variant
description: Record the test results of a variant build, let results of a variant-independent repository count for every variant, and see the evidence as it stood at a baseline.
sidebar:
  order: 4.3
---

A test result without variant counts only for the core. For the test run of a variant build, give the variant, by short ID, UUID or identifier: each enriched test case then counts for that variant. A test case may also name its variant itself with the property `reqseq:variant`, by short ID or identifier; ReqSeq writes the UUID in its place. The command exits with 1 and leaves a test case unchanged when it names another variant than the one given, or a requirement that does not count in its variant (excluded, replaced or not valid there).

One test run can count for the core and for a variant at once, for example a run on the operating system a variant stands for. An enriched test case may carry several `reqseq:variant` properties, each with a variant's UUID or `core`; it then counts for exactly the views it names. Without the property it counts for the core only. Enrich still writes one variant per test case, so add the further `reqseq:variant` properties after enriching.

Some repositories do not know your variants, for example one a supplier keeps for its component. Mark such a repository in `reqseq-workspace.yaml` with `variant-independent: true`; then a result without variant for one of its requirements counts for the core and for every variant the requirement applies in. A result with a variant still counts only there, and together with the results without variant the newest decides. `reqseq workspace status` shows the mark.

```yaml
repositories:
  - { name: system, url: "git@git.example.com:ws/system.git", path: ".", main: true }
  - { name: supplier, url: "git@git.example.com:ws/supplier.git", variant-independent: true }
```

To see the evidence as it stood at a baseline, run `reqseq baseline get "Release 1" --with-evidence`. It gives each requirement's status at its version in the baseline, per view (only the variant's view when the baseline was made for one), and each need's validation status. Only results dated up to the baseline count; results for that version dated after it are listed under `later`. Only each requirement's own results count, so a requirement that `evidence status` shows as `indirect` in a view is `open` in that view's row. The command reads the files on disk, not the commits the baseline names, so check out every repository at the commit the baseline names (its `repositories`); for each one at another commit it warns with `baseline.repository-commit-differs` and both commits.

## App

Run **Enrich JUnit file** in the command prompt and answer the build with Ctrl+Enter (⌘Enter on macOS): the prompt then offers the optional arguments, among them the variant. **Show evidence status** shows the status per view.

## CLI

The commands start from a new workspace with one variant; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create system-requirement "Show the wind speed"
```

```text title="Output"
SR-c67baa  draft  Show the wind speed  [verification: core open]
...
```

```sh
reqseq element create variant "Coastal station"
```

```text title="Output"
VAR-f23826  draft  Coastal station
...
```

```yaml title="reqseq-workspace.yaml"
reqseq-workspace: 1
name: Weather station
repositories:
  - name: system
    url: ""
    main: true
metamodel:
  repository: system
  path: metamodel
evidence:
  - { repository: system, path: evidence }
```

```xml title="evidence/ci/results-coastal-1.xml"
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="wind" tests="1" failures="0">
    <testcase classname="wind" name="[SR-c67baa] shows the wind speed in knots" time="0.01"/>
  </testsuite>
</testsuites>
```

```sh
reqseq evidence enrich-junit evidence/ci/results-coastal-1.xml coastal-1 --variant VAR-f23826
reqseq evidence status --view VAR-f23826
```

```text title="Output"
elements:
  SR-c67baa  draft  Show the wind speed  [verification: core open, VAR-f23826 verified]
...
```

## API

```http
POST /v1/commands/evidence.enrichJunit

{ "file": "evidence/ci/results-coastal-1.xml", "item": "coastal-1", "variant": "VAR-f23826" }
```

```http
POST /v1/commands/baseline.get

{ "baseline": "Release 1", "withEvidence": true }
```

## MCP

```json
{ "name": "evidence_enrichJunit", "arguments": { "file": "evidence/ci/results-coastal-1.xml", "item": "coastal-1", "variant": "VAR-f23826" } }
```

```json
{ "name": "baseline_get", "arguments": { "baseline": "Release 1", "withEvidence": true } }
```
