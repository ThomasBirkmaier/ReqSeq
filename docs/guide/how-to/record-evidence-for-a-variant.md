---
title: Record evidence for a variant
description: Record the test results of an item under test of a variant, let results of a variant-independent repository count for every variant, and see the evidence as it stood at a baseline.
sidebar:
  order: 4.3
---

A test result without variant counts only for the core. For a test run on a variant, give the variant, by short ID, UUID or identifier: each enriched test case then counts for that variant. A test case may also name its variant itself with the property `reqseq:variant`, by short ID or identifier; ReqSeq writes the UUID in its place. The command exits with 1 and leaves a test case unchanged when it names a variant, or `core`, that is not among the ones given, or a requirement that does not count in one of its views (excluded, replaced or not applying there).

One test run can count for the core and for a variant at once, for example a run on the operating system a variant stands for. Give the variant once per view, `core` among them: each enriched test case then gets one `reqseq:variant` property per view, the variant's UUID or `core`, and counts for exactly those views. Without the property a test case counts for the core only.

Such a run often also tests a requirement that applies only in another variant, for example a macOS-only requirement on the Linux runner. By default the command then exits with 1. With the option to skip requirements that are not in the view, a requirement that applies in none of the given views is left out of that test case instead: the test case gets no element, version or criterion for it, `notInView` in the output counts these, and the command ends without error. A test case that names only such requirements gets one `reqseq:not-in-view` property per given view instead, so `workspace check` does not report it as not enriched; a later run that enriches the test case removes the property. A requirement that applies in some of the given views is enriched and counts only where it applies. The option works only together with the variant.

Some repositories do not know your variants, for example one a supplier keeps for its component. Mark such a repository in `reqseq-workspace.yaml` with `variant-independent: true`; then a result without variant for one of its requirements counts for the core and for every variant the requirement applies in. A result with a variant still counts only there, and together with the results without variant the newest decides. `reqseq workspace status` shows the mark.

```yaml
repositories:
  - { name: system, url: "git@git.example.com:ws/system.git", path: ".", main: true }
  - { name: supplier, url: "git@git.example.com:ws/supplier.git", variant-independent: true }
```

To see the evidence as it stood at a baseline, run `reqseq baseline get "Release 1" --with-evidence`. It gives each requirement's status at its version in the baseline, per view (only the variant's view when the baseline was made for one), and each need's validation status. Only results dated up to the baseline count; results for that version dated after it are listed under `later`. Only each requirement's own results count, so a requirement that `evidence status` shows as `indirect` in a view is `open` in that view's row. The command reads the files on disk, not the commits the baseline names, so check out every repository at the commit the baseline names (its `repositories`); for each one at another commit it warns with `baseline.repository-commit-differs` and both commits.

## App

Run **Enrich JUnit file** in the command prompt and answer the item under test with Ctrl+Enter (⌘Enter on macOS): the prompt then offers the optional arguments, among them the variant. **Show evidence status** shows the status per view.

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

A run that counts for the core and the variant at once, and leaves out requirements of other variants:

```xml title="evidence/ci/results-coastal-2.xml"
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="wind" tests="1" failures="0">
    <testcase classname="wind" name="[SR-c67baa] shows the wind speed in knots" time="0.01"/>
  </testsuite>
</testsuites>
```

```sh
reqseq evidence enrich-junit evidence/ci/results-coastal-2.xml coastal-2 --variant core --variant VAR-f23826 --skip-not-in-view
```

```text title="Output"
testCases: 1
withoutReference: 0
notInView: 0
unknown: none
files:
  evidence/ci/results-coastal-2.xml
No problems.
```

## API

```http
POST /v1/commands/evidence.enrichJunit

{ "file": "evidence/ci/results-coastal-1.xml", "item": "coastal-1", "variant": ["VAR-f23826"] }
```

```http
POST /v1/commands/baseline.get

{ "baseline": "Release 1", "withEvidence": true }
```

## MCP

```json
{ "name": "evidence_enrichJunit", "arguments": { "file": "evidence/ci/results-coastal-1.xml", "item": "coastal-1", "variant": ["VAR-f23826"] } }
```

```json
{ "name": "baseline_get", "arguments": { "baseline": "Release 1", "withEvidence": true } }
```
