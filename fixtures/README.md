# fixtures/

Small test data per system requirement (D-055), used by unit and CLI end-to-end tests.

- One folder per SR: `fixtures/SR-xxx/<case>/` with the files of a tiny workspace (`logreq-workspace.yaml`, metamodel, elements).
- Tests copy a case into a temporary folder and, when Git is needed, turn it into a repository with `createFixtureWorkspace` from `@logreq/testkit`. Fixtures are never used in place, so tests can write.

  ```ts
  import { createFixtureWorkspace } from "@logreq/testkit";
  import { Workspace, invoke } from "@logreq/core"; // inside core: relative imports

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
- Large workspaces (50,000 elements, 200,000 relations) are generated, never committed: `generateLargeWorkspace` and `writeLargeWorkspace` of `packages/testkit` with a fixed seed (N-036, D-055). The caller passes the version function (core tests use `computeVersion`, see `packages/core/src/model/generated-workspace.test.ts`). Performance tests live in `packages/*/test/perf/` and run with `pnpm test:perf`, nightly and on PRs labelled `perf` (`.github/workflows/perf.yml`); they record times with `measure`, and `scripts/perf/report.mjs` writes `verification/performance.md`.
- Realistic multi-repository scenarios live in `ThomasBirkmaier/logreq-testdata`.
