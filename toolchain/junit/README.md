# Connect a test tool to LogReq

This guide connects a test tool that writes JUnit XML (Vitest, pytest, Jest, Maven, Gradle, CTest, ...) to the requirements in a LogReq workspace. You need no knowledge of LogReq to follow it, and you write no code: no converter, no script, no plugin. Plan about an hour for the first tool.

The folder also holds a small example: a workspace with four requirements (`workspace/`), Vitest tests (`vitest/`) and pytest tests (`pytest/`). Section "Try it here" runs them from a checkout of this repository.

## What you get

1. Each test names the requirement it checks, by its ID.
2. After the test run, your pipeline calls LogReq **once** per JUnit file. LogReq writes the requirement's ID and its current version (Fassung) into the file.
3. The file, kept in an evidence folder of the workspace, is the evidence. LogReq reads it and shows for each requirement whether it is `verified`, `failed` or still `open`.

The tests name only the ID, never the version. When a requirement changes, the tests stay as they are; the next pipeline run records the new version.

## What you need

- **The `logreq` command line.** It comes with the LogReq delivery. Until the installers exist, build it from a checkout of this repository (Node.js 22.12 or newer, pnpm 10):

  ```sh
  pnpm install && pnpm build
  chmod +x packages/cli/dist/bin.js
  ln -s "$PWD/packages/cli/dist/bin.js" /usr/local/bin/logreq
  ```

  `/usr/local/bin` may need `sudo`; any folder on your `PATH` will do, for example `~/.local/bin`. The link works in scripts and CI steps too (an `alias` would not). Check it with `logreq --help`.
- **A LogReq workspace** (the requirements), checked out on the machine that runs the tests, at the state your tests test against. Its file `logreq-workspace.yaml` must list an evidence folder:

  ```yaml
  evidence:
    - { repository: system, path: evidence }
  ```

  `repository` is the name of a repository listed in the same file, `path` a folder in it. The example workspace in `workspace/` has one.
- **A test tool that writes JUnit XML.**

The commands below are for a POSIX shell (bash, zsh, sh), the shell of most CI runners. In PowerShell write `$env:BUILD` instead of `"$BUILD"` (not tested).

## Step 1: find the ID of the requirement

```sh
logreq element list --workspace path/to/workspace
```

prints one line per element:

```text
  SR-b2c0de  draft  Lock the account
  SR-c3c0de (REQ-012)  draft  Log out when idle
```

`SR-b2c0de` is the **short ID**: the type prefix and the last six digits of the element's UUID. It never changes. `REQ-012` is an **identifier** that your organisation gave the requirement; it works as well, with one difference: LogReq reports a short ID or UUID in a test name that it does not know (a typo), but passes over an unknown identifier in brackets silently, since test tools put other text in brackets too. The full UUID, which `logreq element get SR-b2c0de --workspace path/to/workspace` shows, works too and, like a short ID, is reported when unknown.

## Step 2: name the requirement in the test

There are two ways. Use either; they give the same result.

- **In the test name**, in square brackets: `[SR-b2c0de]`, or with the number of an acceptance criterion `[SR-b2c0de/AK2]`. Several brackets name several requirements.
- **As a property** of the test case named `logreq:element`, with the ID as its value.

A test that names no requirement is passed over. You do not have to name a requirement in every test.

**Vitest** (see `vitest/login.test.js`):

```js
it("[SR-a1c0de] accepts a valid password", () => { /* ... */ });

it("locks the account after three wrong passwords", async ({ annotate }) => {
  await annotate("SR-b2c0de", "logreq:element");
  // ...
});
```

**pytest** (see `pytest/test_login.py`). A plain function name cannot hold brackets, so use a property or a parameter ID:

```python
def test_accepts_a_valid_password(record_property):
    record_property("logreq:element", "SR-a1c0de")
    ...

@pytest.mark.parametrize("passwords", [["a", "b", "c"]], ids=["SR-b2c0de"])
def test_locks_the_account(passwords):
    ...
```

pytest writes properties into its JUnit file only with `junit_family = xunit1` in `pytest.ini` (see `pytest/pytest.ini`). pytest's own parameter lists such as `test_add[1-2]` are passed over; only a bracket that holds an ID counts.

**Any other tool.** Its JUnit file must have, for each test case that checks a requirement, either the ID in brackets in the `name` attribute of the `<testcase>`, or a `<property name="logreq:element" value="SR-b2c0de"/>` inside its `<properties>`. Most tools can do one of the two: put the ID into the test name, or use the tool's way of adding a property. Write one test, run it, open the JUnit file and look for the ID. Step 4 then tells you whether LogReq finds it.

## Step 3: let the tool write JUnit XML

- **Vitest**: in `vitest.config.js` (see `vitest/vitest.config.mjs`)

  ```js
  test: { reporters: ["default", "junit"], outputFile: { junit: "results.xml" } }
  ```

  or on the command line `vitest run --reporter=junit --outputFile=results.xml`.
- **pytest**: `pytest --junitxml=results.xml`.
- **Any other tool**: see its documentation for "JUnit" (Jest: the package `jest-junit`; Maven: Surefire writes `target/surefire-reports/TEST-*.xml`; Gradle: `build/test-results/test/*.xml`; CTest: `ctest --output-junit results.xml`; Go: `go-junit-report`).

## Step 4: the pipeline step

After the tests, in the folder that holds `results.xml`, the pipeline runs this one line:

<!-- tested: pipeline-step -->
```sh
logreq evidence enrich-junit results.xml "$BUILD" --workspace "$LOGREQ_WORKSPACE" --output "$LOGREQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
```

- `results.xml`: the JUnit file of the test tool.
- `"$BUILD"`: what was tested (the Prüfling), for example the build number or the version of your software. Set the variable before, for example `BUILD=build-1`.
- `--workspace "$LOGREQ_WORKSPACE"`: the folder of the workspace checkout (the folder with `logreq-workspace.yaml`).
- `--output ...`: where the enriched file goes: a folder below the evidence folder of the workspace (here `evidence/ci`). One file per run, so the build is part of the name. Without `--output` the file is enriched in place.

The folder of `--output` must exist. Git keeps no empty folders, so create it once in the repository that holds the evidence folder and commit it with an empty file `.gitkeep` in it (as `workspace/evidence/ci/.gitkeep` here), or let the pipeline run `mkdir -p "$LOGREQ_WORKSPACE/evidence/ci"` before the line, as the CI snippets below do.

LogReq adds the UUID, the version, the item (`$BUILD`) and the date to every test case that names a requirement, and prints how many test cases it enriched. It exits with **0** when every named ID is known. It exits with **1** when a test case names an ID the workspace does not have (usually a typo); it lists each such test case with its line, and the pipeline step fails. The other test cases are enriched all the same.

If you have more than one JUnit file, run the line once per file, each with its own `--output` name, for example `results-$BUILD-unit.xml` and `results-$BUILD-api.xml`. The same `--output` twice keeps only the last file, without a message. Tools that write a folder of files (Maven Surefire writes one per test class, so does Gradle) need one line per file, each with its own name, or the tool's option to write one file.

A test case that was enriched once keeps its version: enriching in place again, or running the line on the enriched output, changes nothing. Running the line again on the original `results.xml` (which `--output` leaves as it was) records the current version and replaces the output.

## Step 5: check

```sh
logreq evidence status --workspace "$LOGREQ_WORKSPACE"
```

shows each requirement with `[verification: core verified]` (its newest test result for its current version passed), `core failed` (it failed), `core outdated` (results only for an older version) or `core open` (no result). A skipped test gives no result. `logreq workspace check --workspace "$LOGREQ_WORKSPACE"` lists problems with evidence files (codes starting with `evidence.`).

In the LogReq app, open the workspace again to see a file the pipeline wrote while the app was open.

## Step 6: keep the file

The enriched file is only evidence while it lies in the evidence folder of the workspace and belongs to a state of it: commit it to the repository that holds the evidence folder, as a step of your pipeline (for example `git add evidence/ci && git commit -m "Test results of $BUILD" && git push` in the workspace checkout). LogReq never commits for you. If your pipeline keeps the file only as a pipeline artifact, it is kept, but LogReq reads it only once it is copied into the evidence folder.

## In your CI

These snippets show where the line goes. They were not run on a CI server; the one LogReq line in them is the tested line of step 4. Both run the step even when a test failed, so a failed test is recorded too. `logreq` must be on the runner's `PATH`: until the installers exist, with the link of "What you need".

GitHub Actions:

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
        run: mkdir -p "$LOGREQ_WORKSPACE/evidence/ci"
        env:
          LOGREQ_WORKSPACE: requirements
      - name: Connect the test results to the requirements
        if: always()
        env:
          BUILD: build-${{ github.run_number }}
          LOGREQ_WORKSPACE: requirements
        run: logreq evidence enrich-junit results.xml "$BUILD" --workspace "$LOGREQ_WORKSPACE" --output "$LOGREQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
      # Kept as an artifact only; LogReq reads the file once it is committed (step 6).
      - name: Keep the file as an artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: evidence
          path: requirements/evidence/ci/
```

GitLab CI:

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
    LOGREQ_WORKSPACE: requirements
  script:
    # The requirements, at the state the tests test against: pin it with --branch <branch or tag>.
    - git clone --depth 1 --branch main https://git.example.com/your-org/requirements.git requirements
    - mkdir -p "$LOGREQ_WORKSPACE/evidence/ci"
    - logreq evidence enrich-junit results.xml "$BUILD" --workspace "$LOGREQ_WORKSPACE" --output "$LOGREQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
  artifacts:
    paths:
      - requirements/evidence/ci/
```

Add the commit of step 6 where your pipeline may push to the requirements repository.

## When something goes wrong

- **Exit 1 with `evidence.unknown-element`**: a test names an ID the workspace does not have. Check the spelling with `logreq element list`, and that `--workspace` points to the right checkout.
- **`evidence.not-enriched`** in `workspace check` or `evidence status`: a JUnit file in the evidence folder that was not run through step 4. Run the step on it, or move it out of the evidence folder.
- **A requirement stays `open`** although its test ran: the test case does not name it (look into the JUnit file, step 2), the test was skipped, or the file is not in the evidence folder (step 6).
- **A requirement is `outdated`**: it changed after its last test run. The next run of step 4 records the new version.
- **A test that ran twice** (a rerun) gives two results; the newest decides.
- **Very large files** (several hundred thousand test cases) can run out of memory. Give Node.js more: `NODE_OPTIONS=--max-old-space-size=8192` before the line.

## Try it here

From the root of a checkout of this repository, after "What you need" (`pnpm install && pnpm build` and the link), in one shell. The workspace is copied to a folder in your home folder, so the checkout stays as it is. If you tried before, start with `rm -rf "$HOME/logreq-example"`, or `cp` puts the new copy inside the old one:

<!-- tested: try-vitest -->
```sh
export CHECKOUT="$PWD"
export EXAMPLE="$HOME/logreq-example"
export LOGREQ_WORKSPACE="$EXAMPLE/workspace"
export BUILD=build-1
mkdir -p "$EXAMPLE"
cp -R toolchain/junit/workspace "$LOGREQ_WORKSPACE"
logreq element list --workspace "$LOGREQ_WORKSPACE"
pnpm exec vitest run --root toolchain/junit/vitest --outputFile.junit="$EXAMPLE/results.xml"
cd "$EXAMPLE"
logreq evidence enrich-junit results.xml "$BUILD" --workspace "$LOGREQ_WORKSPACE" --output "$LOGREQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
logreq evidence status --workspace "$LOGREQ_WORKSPACE"
```

Vitest runs five tests (one skipped). The last command shows SR-a1c0de, SR-b2c0de and SR-c3c0de (REQ-012) `core verified`, and SR-d4c0de `core open`: its only test was skipped.

The pytest example comes with the JUnit file of a real run (`pytest/results.xml`, pytest 9.1.1, `pytest --junitxml=results.xml` in `pytest/`). In the same shell:

<!-- tested: try-pytest -->
```sh
export BUILD=build-2
cp "$CHECKOUT/toolchain/junit/pytest/results.xml" results.xml
logreq evidence enrich-junit results.xml "$BUILD" --workspace "$LOGREQ_WORKSPACE" --output "$LOGREQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
logreq evidence status --workspace "$LOGREQ_WORKSPACE"
```

SR-a1c0de and SR-b2c0de now have results of both runs and stay `core verified`. With pytest installed, record a file of your own instead of the copy: `(cd "$CHECKOUT/toolchain/junit/pytest" && pytest --junitxml="$EXAMPLE/results.xml")`. Remove the example with `rm -rf "$EXAMPLE"`.

Running Vitest in `toolchain/junit/vitest` leaves its cache in `toolchain/junit/vitest/node_modules/`, and pytest leaves `.pytest_cache/` and `__pycache__/` in `toolchain/junit/pytest`; Git ignores them.

**Note for this repository.** The end-to-end test `packages/cli/test/e2e/toolchain-junit.test.ts` reads this guide: it runs the blocks marked `tested` (the `logreq` lines as written), and checks that the CI snippets hold the line of step 4. When you change a marked block, run `pnpm build && pnpm test:e2e`. LogReq's own trace-check reads every test file of the repository, also the examples: never write `[SR-` with three digits and `/AK` and a number in brackets in them, it would be read as a test of LogReq.

## Evaluation tools

Dashboards and reports (Grafana and others) do not read JUnit files through LogReq. They read the data LogReq exports for each state (`logreq data export`), which holds the requirements with their evidence and status. That is not part of this guide.
