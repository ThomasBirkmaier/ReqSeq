import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ADR-0011: the performance suite on the generated 50,000-element workspace (packages/testkit,
// D-055), `pnpm test:perf`. It runs nightly and on pull requests labelled `perf`
// (.github/workflows/perf.yml), never in the required test run. Each measurement is appended to
// LOGREQ_PERF_RESULTS; `scripts/perf/report.mjs` writes verification/performance.md from it.
// No coverage: the unit tests carry the coverage thresholds (ADR-0016).
export default defineConfig({
  resolve: {
    alias: { "@logreq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/perf/**/*.test.ts"],
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
    env: { LOGREQ_PERF_RESULTS: "test-results/perf.jsonl" },
    // One file at a time, so that measurements do not compete for the cores.
    fileParallelism: false,
    // Generating and loading 50,000 files takes minutes on a slow runner; tests set their own bounds.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    reporters: ["default", ["junit", { outputFile: "test-results/junit-perf.xml", addFileAttribute: true }]],
  },
});
