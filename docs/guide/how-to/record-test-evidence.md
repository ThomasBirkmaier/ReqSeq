---
title: Record test evidence from JUnit XML
description: Connect the JUnit XML file of any test tool to the requirements it tests, and see which requirements are verified.
sidebar:
  order: 4
---

Any test tool that writes JUnit XML (Vitest, pytest, Jest, Maven, Gradle, CTest and others) can show that requirements are met, without a converter or plugin:

1. Each test names the requirement it checks by its short ID, in square brackets in the test name (`[SR-c67baa] shows the wind speed`), or as the test case property `reqseq:element`. Where test names cannot hold brackets, as in Rust, Go or Java, a name pattern finds the short ID in another form (`sr_c67baa_ak1`).
2. The test tool writes its JUnit file into an evidence folder of the workspace, one file per build.
3. ReqSeq enriches the file once: it adds the UUID and the current version of each named requirement, the build (the item under test) and the date.

The tests name only the ID, never the version. When a requirement changes, the next run records the new version, and until then the requirement shows as `outdated`. The guide for connecting a test tool in the delivery, `resources/docs/junit/`, has examples for Vitest, pytest and CI services.

The workspace file `reqseq-workspace.yaml` must list the evidence folder, under the name of one of its repositories:

```yaml
evidence:
  - { repository: system, path: evidence }
```

## App

Run **Enrich JUnit file** in the command prompt (Ctrl+Shift+P, ⌘⇧P on macOS); it asks for the file and the build. **Show evidence status** then lists each requirement with its verification status, and **Show evidence coverage** counts per level how many have evidence. Reopen the workspace to see a file a pipeline wrote while the app was open.

## CLI

The commands start from a new workspace; in yours, use your own short IDs.

```sh
reqseq workspace init . "Weather station"
reqseq element create system-requirement "Show the wind speed" --text "The station must show the wind speed in knots."
```

```text title="Output"
SR-c67baa  draft  Show the wind speed
...
```

With the evidence folder in the workspace file:

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

A run of the test tool then writes, for example with `vitest run --reporter=junit --outputFile=evidence/ci/results-build-1.xml`:

```xml title="evidence/ci/results-build-1.xml"
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="wind" tests="1" failures="0">
    <testcase classname="wind" name="[SR-c67baa] shows the wind speed in knots" time="0.01"/>
  </testsuite>
</testsuites>
```

After the test run, in the pipeline:

```sh
reqseq evidence enrich-junit evidence/ci/results-build-1.xml build-1
```

```text title="Output"
testCases: 1
withoutReference: 0
unknown: none
files:
  evidence/ci/results-build-1.xml
No problems.
```

`withoutReference` counts the test cases that name no requirement; it does not change the exit code. The command exits with 1 when a test names an ID the workspace does not have, usually a typo, and lists those test cases; the others are enriched all the same. When the tool writes its file elsewhere, add `--output evidence/ci/results-build-1.xml`; the folder must exist. Commit the enriched file: ReqSeq never commits.

### Test names without brackets

Rust, Go and Java test names cannot hold `[SR-c67baa]`. Write the short ID into the name in another form, and give the form with `--name-pattern`: `{prefix}` stands for a type prefix of the metamodel (`SR`), `{id}` for the hex digits of the short ID, and `{ak}` for the number of an acceptance criterion, which ReqSeq ignores. Everything else is literal text, and case does not matter. For a Rust test, as `cargo nextest run` writes it to its JUnit file:

```rust
#[test]
fn sr_c67baa_ak1_shows_the_wind_speed_in_knots() { /* … */ }
```

```sh
reqseq evidence enrich-junit evidence/ci/results-build-1.xml build-1 --name-pattern "{prefix}_{id}_ak{ak}"
```

The same works for Go (`func TestSRc67baaAK1(t *testing.T)` with `Test{prefix}{id}AK{ak}`) and Java (`void src67baaAk1()` with `{prefix}{id}Ak{ak}`): the hex digits end where the following text fits, or where a camel case word starts. A match starts and ends at a word boundary: the start or end of the name, a character that is no letter or digit, or the start of a camel case word; so `loaded123456` never gives D-ed123456. Names are read outside square brackets only, and the class name is not read. A short ID the pattern finds that the workspace does not have makes the command exit with 1, like one in brackets.

Some forms stay ambiguous: write a separator or literal text between the parts when a prefix and the start of the ID could be read two ways (`de123456` with the prefixes `D` and `DE`), when hex letters follow the ID without a separator (`sr_c67baaface`), and keep in mind that an identifier such as `sr_029` has too few digits and counts as without reference, as does a criterion number of ten or more digits.

### Variants

For the test run of a variant build, add `--variant` with the variant's short ID, UUID or identifier, for example `--variant VAR-f23826`: each enriched test case then counts for that variant. A test case may also name its variant itself with the property `reqseq:variant`, by short ID or identifier; ReqSeq writes the UUID in its place. The command exits with 1 and leaves a test case unchanged when it names another variant than `--variant`, or a requirement that does not count in its variant (excluded, replaced or not valid there).

```sh
reqseq evidence status
```

```text title="Output"
elements:
  SR-c67baa  draft  Show the wind speed  [verification: core verified]
total: 1
```

The status is `verified` when the newest result for the current version passed, `failed` when it failed, `outdated` with results for an older version only, and `open` without results. `reqseq evidence coverage` counts the requirements with and without evidence.

To see the evidence as it stood at a baseline, run `reqseq baseline get "Release 1" --with-evidence`. It gives each requirement's status at its version in the baseline, per view (only the variant's view when the baseline was made for one), and each need's validation status. Only results dated up to the baseline count; results for that version dated after it are listed under `later`.

For a check that is no automated test, such as an inspection, write a record by hand:

```sh
reqseq evidence record SR-c67baa verification passed --method inspection --item build-1
```

## API

With `reqseq serve api` running in the workspace, and the token of `api.json` as `Authorization: Bearer <token>`:

```http
POST /v1/commands/evidence.enrichJunit

{ "file": "evidence/ci/results-build-1.xml", "item": "build-1" }
```

With a name pattern:

```http
POST /v1/commands/evidence.enrichJunit

{ "file": "evidence/ci/results-build-1.xml", "item": "build-1", "namePattern": "{prefix}_{id}_ak{ak}" }
```

```http
POST /v1/commands/evidence.status

{}
```

```http
POST /v1/commands/evidence.record

{ "ref": "SR-c67baa", "kind": "verification", "result": "passed", "method": "inspection", "item": "build-1" }
```

## MCP

```json
{ "name": "evidence_enrichJunit", "arguments": { "file": "evidence/ci/results-build-1.xml", "item": "build-1" } }
```

```json
{ "name": "evidence_enrichJunit", "arguments": { "file": "evidence/ci/results-build-1.xml", "item": "build-1", "namePattern": "{prefix}_{id}_ak{ak}" } }
```

```json
{ "name": "evidence_status", "arguments": {} }
```

```json
{ "name": "evidence_record", "arguments": { "ref": "SR-c67baa", "kind": "verification", "result": "passed", "method": "inspection", "item": "build-1" } }
```

The reference has every option of [evidence.enrichJunit](/reference/commands/evidence-enrich-junit/), [evidence.status](/reference/commands/evidence-status/), [evidence.coverage](/reference/commands/evidence-coverage/) and [evidence.record](/reference/commands/evidence-record/), and the [JUnit format](/reference/formats/) ReqSeq reads.
