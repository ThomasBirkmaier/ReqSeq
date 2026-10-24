import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ADR-0011: the performance suite on the generated 50,000-element workspace (packages/testkit,
// D-055), `pnpm test:perf`. It runs nightly and on pull requests labelled `perf`
// (.github/workflows/perf.yml), never in the required test run. Each measurement is appended to
// LOGREQ_PERF_RESULTS; `scripts/perf/report.mjs` writes verification/performance.md from it.
// No coverage: the unit tests carry the 100 % (ADR-0016).
export default defineConfig({
  resolve: {
    alias: { "@logreq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/perf/**/*.test.ts"],
    setupFiles: ["./scripts/test-support/block-network.mjs"],
    env: { LOGREQ_PERF_RESULTS: "test-results/perf.jsonl" },
    // One file at a time, so that measurements do not compete for the cores.
    fileParallelism: false,
    // Generating and loading 50,000 files takes minutes on a slow runner; tests set their own bounds.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    reporters: ["default", ["junit", { outputFile: "test-results/junit-perf.xml", addFileAttribute: true }]],
  },
});
