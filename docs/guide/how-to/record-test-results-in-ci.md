---
title: Record test results in CI
description: Add the one pipeline step that ties the JUnit file of a test run to the requirements, in GitHub Actions, GitLab CI or any other CI service.
sidebar:
  order: 4.2
---

After the tests, the pipeline runs one line per JUnit file, `reqseq evidence enrich-junit results.xml "$BUILD" --workspace "$REQSEQ_WORKSPACE" --output "$REQSEQ_WORKSPACE/evidence/ci/results-$BUILD.xml"`, as in the snippets below; nothing else connects the test tool. In PowerShell, write `$env:BUILD` for `$BUILD`. The machine needs the `reqseq` command line on its path ([Install ReqSeq](/how-to/install-reqseq/)) and a checkout of the workspace at the state the tests test against.

- `results.xml` is the JUnit file of the test tool, and `$BUILD` what was tested (the item under test), such as the build number or version.
- `--workspace` is the folder with `reqseq-workspace.yaml`.
- `--output` is where the enriched file goes: a folder below an evidence folder of the workspace, one file per run, so the build is part of the name. Without it the file is enriched in place. The folder must exist; Git keeps no empty folders, so commit it with an empty `.gitkeep`, or run `mkdir -p` before the line.

The line exits with 1 when a test names an ID the workspace does not have, and lists those test cases, so the step fails; the other test cases are enriched all the same. A high `withoutReference` count may mean that tests name their requirement in a form ReqSeq does not read ([Name the requirement in a test](/how-to/name-the-requirement-in-a-test/)).

Run the line once per JUnit file, each with its own `--output` name, for example `results-$BUILD-unit.xml` and `results-$BUILD-api.xml`: the same `--output` twice keeps only the last file, without a message. Tools that write a folder of files, such as Maven Surefire and Gradle, need one line per file or their option to write one file. A test case that was enriched once keeps its version, so running the line again on its output changes nothing.

The enriched file is evidence only once it is committed in the evidence folder: let the pipeline commit it where it may push to the requirements repository (`git add evidence/ci && git commit -m "Test results of $BUILD"`). ReqSeq never commits. A file kept only as a pipeline artifact is read once it is copied there.

**GitHub Actions** (both snippets run the step when a test failed too, so a failure is recorded):

<!-- tested: ci-github -->
```yaml
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      # The requirements, at the state the tests test against (pin it with `ref:`).
      - uses: actions/checkout@v4
        with:
          repository: your-org/requirements
          path: requirements
      - run: npm ci
      - run: npx vitest run
      - name: Make the evidence folder (Git keeps no empty folders)
        if: always()
        run: mkdir -p "$REQSEQ_WORKSPACE/evidence/ci"
        env:
          REQSEQ_WORKSPACE: requirements
      - name: Connect the test results to the requirements
        if: always()
        env:
          BUILD: build-${{ github.run_number }}
          REQSEQ_WORKSPACE: requirements
        run: reqseq evidence enrich-junit results.xml "$BUILD" --workspace "$REQSEQ_WORKSPACE" --output "$REQSEQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
      - name: Keep the file as an artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: evidence
          path: requirements/evidence/ci/
```

**GitLab CI**:

<!-- tested: ci-gitlab -->
```yaml
test:
  stage: test
  script:
    - npm ci
    - npx vitest run
  artifacts:
    when: always
    paths:
      - results.xml

evidence:
  stage: .post
  when: always
  variables:
    BUILD: build-$CI_PIPELINE_IID
    REQSEQ_WORKSPACE: requirements
  script:
    # The requirements, at the state the tests test against: pin it with --branch <branch or tag>.
    - git clone --depth 1 --branch main https://git.example.com/your-org/requirements.git requirements
    - mkdir -p "$REQSEQ_WORKSPACE/evidence/ci"
    - reqseq evidence enrich-junit results.xml "$BUILD" --workspace "$REQSEQ_WORKSPACE" --output "$REQSEQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
  artifacts:
    paths:
      - requirements/evidence/ci/
```

The snippets were not run on a CI server; their `reqseq` line is tested with a real Vitest run and the JUnit file of a real pytest run. A Vitest and a pytest example to try out come with the delivery, in `resources/docs/junit/`.

**When something goes wrong:**

- `evidence.unknown-element`, exit 1: a test names an ID the workspace does not have. Check the spelling with `reqseq element list`, and that `--workspace` is the right checkout.
- `evidence.not-enriched` in `workspace check` or `evidence status`: a JUnit file in the evidence folder that did not go through the line. Run it, or move the file out. A line with `--skip-not-in-view` also leaves a test case unenriched when every requirement it names applies in none of the given views, for example a macOS-only requirement in the file of the Linux runner; the warning counts these test cases too.
- A requirement stays `open` although its test ran: the test case does not name it, the test was skipped, or the file is not in the evidence folder.
- A requirement is `outdated`: it changed after its last test run; the next run records the new version. A test that ran twice gives two results, and the newest decides.
- Files with several hundred thousand test cases can run out of memory: set `NODE_OPTIONS=--max-old-space-size=8192`.

## App

The pipeline step is the command line's. The app shows its result: **Show evidence status** lists the requirements with their status, also for a file a pipeline writes while the app is open.

## CLI

The same step on a new workspace, with a fixed build:

```sh
reqseq workspace init . "Weather station"
reqseq element create system-requirement "Show the wind speed"
```

```text title="Output"
SR-c67baa  draft  Show the wind speed  [verification: core open]
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

```xml title="results.xml"
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="wind" tests="1" failures="0">
    <testcase classname="wind" name="[SR-c67baa] shows the wind speed in knots" time="0.01"/>
  </testsuite>
</testsuites>
```

```text title="evidence/ci/.gitkeep"
```

```sh
reqseq evidence enrich-junit results.xml build-1 --workspace . --output evidence/ci/results-build-1.xml
```

```text title="Output"
testCases: 1
withoutReference: 0
notInView: 0
unknown: none
files:
  evidence/ci/results-build-1.xml
No problems.
```

## API

```http
POST /v1/commands/evidence.enrichJunit

{ "file": "results.xml", "item": "build-1", "output": "evidence/ci/results-build-1.xml" }
```

## MCP

```json
{ "name": "evidence_enrichJunit", "arguments": { "file": "results.xml", "item": "build-1", "output": "evidence/ci/results-build-1.xml" } }
```
