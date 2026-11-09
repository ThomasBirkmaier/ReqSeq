# Example: connect a test tool to ReqSeq

How to connect a test tool that writes JUnit XML is part of the ReqSeq documentation, which comes with every delivery in the version of the delivery (`reqseq serve docs`, or Help > ReqSeq Documentation in the app): the pages "Record test evidence from JUnit XML", "Name the requirement in a test" and "Record test results in CI". Online, for the newest version: [Record test evidence from JUnit XML](https://thomasbirkmaier.github.io/ReqSeq/how-to/record-test-evidence/), [Name the requirement in a test](https://thomasbirkmaier.github.io/ReqSeq/how-to/name-the-requirement-in-a-test/) and [Record test results in CI](https://thomasbirkmaier.github.io/ReqSeq/how-to/record-test-results-in-ci/).

This folder holds the example those pages refer to: a workspace with four requirements (`workspace/`), Vitest tests with their configuration (`vitest/`) and pytest tests with `pytest.ini` and the JUnit file of a real run (`pytest/`). The delivery has it in `resources/docs/junit/`.

## Try it here

From the root of a checkout of this repository, after `pnpm install && pnpm build`, with `reqseq` on your path: from a delivery ([Install ReqSeq](https://thomasbirkmaier.github.io/ReqSeq/how-to/install-reqseq/)), or `chmod +x packages/cli/dist/bin.js` and a link to it in a folder on your `PATH` (an `alias` does not reach scripts). pnpm 12 needs `npm install -g pnpm@12.14.0 --force`, since corepack up to 0.34 cannot start it. Run the blocks in one shell. The workspace is copied to a folder in your home folder, so the checkout stays as it is. If you tried before, start with `rm -rf "$HOME/reqseq-example"`, or `cp` puts the new copy inside the old one:

<!-- tested: try-vitest -->
```sh
export CHECKOUT="$PWD"
export EXAMPLE="$HOME/reqseq-example"
export REQSEQ_WORKSPACE="$EXAMPLE/workspace"
export BUILD=build-1
mkdir -p "$EXAMPLE"
cp -R toolchain/junit/workspace "$REQSEQ_WORKSPACE"
reqseq element list --workspace "$REQSEQ_WORKSPACE"
pnpm exec vitest run --root toolchain/junit/vitest --outputFile.junit="$EXAMPLE/results.xml"
cd "$EXAMPLE"
reqseq evidence enrich-junit results.xml "$BUILD" --workspace "$REQSEQ_WORKSPACE" --output "$REQSEQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
reqseq evidence status --workspace "$REQSEQ_WORKSPACE"
```

Vitest runs five tests (one skipped). The last command shows SR-a1c0de, SR-b2c0de and SR-c3c0de (REQ-012) `core verified`, and SR-d4c0de `core open`: its only test was skipped.

The pytest example comes with the JUnit file of a real run (`pytest/results.xml`, pytest 9.1.1, `pytest --junitxml=results.xml` in `pytest/`). In the same shell:

<!-- tested: try-pytest -->
```sh
export BUILD=build-2
cp "$CHECKOUT/toolchain/junit/pytest/results.xml" results.xml
reqseq evidence enrich-junit results.xml "$BUILD" --workspace "$REQSEQ_WORKSPACE" --output "$REQSEQ_WORKSPACE/evidence/ci/results-$BUILD.xml"
reqseq evidence status --workspace "$REQSEQ_WORKSPACE"
```

SR-a1c0de and SR-b2c0de now have results of both runs and stay `core verified`. With pytest installed, record a file of your own instead of the copy: `(cd "$CHECKOUT/toolchain/junit/pytest" && pytest --junitxml="$EXAMPLE/results.xml")`. Remove the example with `rm -rf "$EXAMPLE"`.

Running Vitest in `toolchain/junit/vitest` leaves its cache in `toolchain/junit/vitest/node_modules/`, and pytest leaves `.pytest_cache/` and `__pycache__/` in `toolchain/junit/pytest`; Git ignores them.

**Note for this repository.** The end-to-end test `packages/cli/test/e2e/toolchain-junit.test.ts` reads this file and `docs/guide/how-to/record-test-results-in-ci.md`: it runs the blocks marked `tested` here (the `reqseq` lines as written), and checks that they and the CI snippets of the page run the same pipeline line. When you change a marked block, run `pnpm build && pnpm test:e2e`. ReqSeq's own trace-check reads every test file of the repository, also the examples: never write `[SR-` with three digits and `/AK` and a number in brackets in them, it would be read as a test of ReqSeq.
