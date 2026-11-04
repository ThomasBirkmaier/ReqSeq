---
title: Record test evidence from JUnit XML
description: Connect the JUnit XML file of any test tool to the requirements it tests, and see which requirements are verified.
sidebar:
  order: 4
---

Any test tool that writes JUnit XML (Vitest, pytest, Jest, the Node test runner with `--test-reporter=junit`, Maven, Gradle, CTest and others) can show that requirements are met, without a converter or plugin:

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

`withoutReference` counts the test cases that name no requirement; it does not change the exit code. The command exits with 1 when a test names an ID the workspace does not have, usually a typo, and lists those test cases; the others are enriched all the same. A test that names a need or another element that is no requirement is enriched too, with an `evidence.kind-mismatch` warning: its result counts for no status, so name the requirement instead, or record the validation of the need with `evidence record`. When the tool writes its file elsewhere, add `--output evidence/ci/results-build-1.xml`; the folder must exist. Commit the enriched file: ReqSeq never commits.

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

Some forms stay ambiguous: write a separator or literal text between the parts when a prefix and the start of the ID could be read two ways (`de123456` with the prefixes `D` and `DE`), when hex letters follow the ID without a separator (`sr_c67baaface`), and keep in mind that an identifier such as `sr_029` has too few digits and counts as without reference, as does a criterion number of ten or more digits. A name whose next word follows the match without a separator (`sr_c67baa_ak1parses`) counts as without reference too, and so does an ID in upper case right before a lower-case word (`SR2F95EAdd` for SR-2f95ea: the hex digits end where the camel case word `Add` starts, after `2F95E`); write `sr_c67baa_ak1_parses`, and `SR2f95eaAdd` or `SR2F95EA_add`. Without a separator, `{prefix}{id}` can also read a hash as a short ID (`TestCacheKeyD41d8cd98f00` gives D-41d8cd98f00), so the command exits with 1 for it unless the workspace has that ID. `workspace check` does not know the pattern, so a file whose test cases name requirements only this way gives no `evidence.not-enriched` warning when it was not enriched.

### Variants

For the test run of a variant build, add `--variant` with the variant's short ID, UUID or identifier, for example `--variant VAR-f23826`: each enriched test case then counts for that variant. A test case may also name its variant itself with the property `reqseq:variant`, by short ID or identifier; ReqSeq writes the UUID in its place. The command exits with 1 and leaves a test case unchanged when it names another variant than `--variant`, or a requirement that does not count in its variant (excluded, replaced or not valid there).

A result without variant counts only for the core. Some repositories do not know your variants, for example one a supplier keeps for its component. Mark such a repository in `reqseq-workspace.yaml` with `variant-independent: true`; then a result without variant for one of its requirements counts for the core and for every variant the requirement applies in. A result with a variant still counts only there, and together with the results without variant the newest decides. `reqseq workspace status` shows the mark.

```yaml
repositories:
  - { name: system, url: "git@git.example.com:ws/system.git", path: ".", main: true }
  - { name: supplier, url: "git@git.example.com:ws/supplier.git", variant-independent: true }
```

```sh
reqseq evidence status
```

```text title="Output"
elements:
  SR-c67baa  draft  Show the wind speed  [verification: core verified]
total: 1
```

The status is `verified` when the newest result for the current version passed, `failed` when it failed, `outdated` with results for an older version only, and `open` without results. `reqseq evidence coverage` counts the requirements with and without evidence.

To see the evidence as it stood at a baseline, run `reqseq baseline get "Release 1" --with-evidence`. It gives each requirement's status at its version in the baseline, per view (only the variant's view when the baseline was made for one), and each need's validation status. Only results dated up to the baseline count; results for that version dated after it are listed under `later`. Only each requirement's own results count, so a requirement that `evidence status` shows as `indirect` in a view is `open` in that view's row. The command reads the files on disk, not the commits the baseline names, so check out every repository at the commit the baseline names (its `repositories`); for each one that is at another commit it warns with `baseline.repository-commit-differs` and both commits.

For a check that is no automated test, such as an inspection, write a record by hand:

```sh
reqseq evidence record SR-c67baa verification passed --method inspection --item build-1
```

A validation that cannot be judged yet is recorded as `inconclusive`, with the reason, which `evidence status` and `element get` then show:

```sh
reqseq evidence record SR-c67baa validation inconclusive --reason "The field test needs a winter with frost"
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
