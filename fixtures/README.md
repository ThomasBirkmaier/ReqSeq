# fixtures/

Small test data per system requirement, used by unit and CLI end-to-end tests.

- One folder per SR: `fixtures/SR-xxx/<case>/` with the files of a tiny workspace (`reqseq-workspace.yaml`, metamodel, elements).
- Tests copy a case into a temporary folder and, when Git is needed, turn it into a repository with `createFixtureWorkspace` from `@reqseq/testkit`. Fixtures are never used in place, so tests can write.

  ```ts
  import { createFixtureWorkspace } from "@reqseq/testkit";
  import { Workspace, invoke } from "@reqseq/core"; // inside core: relative imports

  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository", // copied from fixtures/SR-004/one-repository/ (optional)
    files: { "product/SR-825b7146fb54.md": "---\n...\n---\n" }, // written on top (optional)
    git: ["product", "system"], // one repository with one commit per folder; `true` for the root (optional)
  });
  onTestFinished(() => fixture.cleanup());
  const out = await invoke("workspace.status", {}, { workspace: new Workspace(fixture.root) });
  ```

  Commits use an empty Git config, a fixed author and fixed dates, so commit IDs are the same on every run and machine. `fixture.write`, `fixture.commit`, `fixture.head` and `fixture.git` change and inspect the repositories afterwards.
- Keep cases minimal: only the files the acceptance criterion needs.
- `fixtures/displays/` holds no workspace: the inputs of a display model (ADR-0019) as the commands give them, which the export's and the app's renderer tests both read (`element-page.json`: `packages/core/src/html-export/display-render.test.ts`, `packages/app/src/renderer/display-render.test.ts`; `neighbourhood.json`: `packages/core/src/html-export/neighbourhood-render.test.ts`, `packages/app/src/renderer/neighbourhood-render.test.ts`; `overview.json`: the export's test only, until the app overview renders `overviewDisplay`).
- Large workspaces (50,000 elements, 200,000 relations) are generated, never committed: `generateLargeWorkspace` and `writeLargeWorkspace` of `packages/testkit` with a fixed seed (N-036). The caller passes the version function (core tests use `computeVersion`, see `packages/core/src/model/generated-workspace.test.ts`). Performance tests live in `packages/*/test/perf/` and run with `pnpm test:perf`, nightly and on PRs labelled `perf` (`.github/workflows/perf.yml`); they record times with `measure` (memory with `measurePeakMemory`), and `scripts/perf/report.mjs` writes `verification/performance.md`, which the nightly run commits to the branch `perf-record`. `perfSize` gives a test its size: 50,000 elements, or the number `REQSEQ_PERF_ELEMENTS` sets, raised to a test's own minimum; with fewer than 50,000 the suite records no time, asserts no threshold (`thresholdLimit`) and writes no JUnit file, and `scaledCount` scales the counts a test takes at N-036. The required `checks (ubuntu-24.04)` runs it with 500 elements (#2037). The option `variantRules` adds exclusions and replacements (by default 5,000 each, which fit the N-036 workspace; a smaller one passes its own counts) in a pass with its own seed, so the other files stay as they are (`variant-view.test.ts`). `withEvidenceRecords` adds an evidence location with the records of such a workspace (JUnit files of CI runs, Markdown verification and validation records; E4, ThomasBirkmaier/ReqSeq-archive#583; `coreAndVariant` lets every test case name the core and one variant, SR-093 AK5), `pytestJunit` one JUnit file as pytest writes it for `evidence.enrichJunit`.
- The web UI tests (ADR-0020) get their workspaces from `packages/testkit/src/ui-workspaces.ts`, each in a fresh temporary folder: `createSpecCopyWorkspace` (a copy of `spec/` with a generated Git history of three commits and the baseline `Generated`), `createOrbitLabWorkspace` (an unusual metamodel: other type keys, an abstract requirement type with two subtypes, other statuses, no glossary, criteria without keys) and `createNoIdentifierWorkspace` (stakeholders, needs, hazards and system requirements, without identifiers). The caller passes `run`, which runs a catalog command, so elements, baselines and evidence records carry the versions ReqSeq computes; `packages/core/src/model/ui-workspaces.test.ts` checks each with `workspace.check`.
