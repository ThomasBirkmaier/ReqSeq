import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { perfSize } from "./packages/testkit/src/perf.js";

// ADR-0011: the performance suite on the generated 50,000-element workspace (packages/testkit,
// D-055), `pnpm test:perf`. It runs nightly and on pull requests labelled `perf`
// (.github/workflows/perf.yml). Each measurement is appended to
// REQSEQ_PERF_RESULTS; `scripts/perf/report.mjs` writes verification/performance.md from it.
// With REQSEQ_PERF_ELEMENTS below 50,000 (`perfSize`, #2037) the same tests run on a smaller workspace in the
// required PR CI (ci.yml): their counts, findings and output shapes, without times. Such a run records no
// measurement and writes no JUnit file, so neither the record nor the evidence of a tagged AK comes from it.
// No coverage: the unit tests carry the coverage thresholds (ADR-0016).
const { full } = perfSize();

export default defineConfig({
  resolve: {
    alias: { "@reqseq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/perf/**/*.test.ts"],
    // The vendor files of the HTML export, built when missing (scripts/test-support/html-export-vendor.mjs).
    globalSetup: ["./scripts/test-support/html-export-vendor.mjs"],
    setupFiles: ["./scripts/test-support/block-network.mjs"],
    // Worker threads that core starts (ADR-0008) load the TypeScript sources: scripts/test-support/worker-preload.mjs.
    // `--import` takes a URL (a Windows path, C:\..., is no valid specifier). Node strips the types
    // by default only from 22.18; the flag does it on every Node 22 that `engines` allows.
    // `--expose-gc`: heap measurements collect garbage first (packages/core/test/perf/search-index.test.ts).
    execArgv: [
      "--expose-gc",
      "--experimental-strip-types",
      "--import",
      new URL("./scripts/test-support/worker-preload.mjs", import.meta.url).href,
    ],
    env: full ? { REQSEQ_PERF_RESULTS: "test-results/perf.jsonl" } : {},
    // One file at a time, so that measurements do not compete for the cores; a smaller run measures nothing and
    // runs the files side by side (52 s instead of 137 s on 4 cores, #2037).
    fileParallelism: !full,
    // Generating and loading 50,000 files takes minutes on a slow runner; tests set their own bounds.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    reporters: full
      ? ["default", ["junit", { outputFile: "test-results/junit-perf.xml", addFileAttribute: true }]]
      : ["default"],
  },
});
