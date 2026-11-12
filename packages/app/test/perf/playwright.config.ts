// The app's part of the performance suite (ADR-0011, #147): Playwright drives the built app (`pnpm build:electron`)
// on the generated workspace of N-036 (path completion, SR-143 AK5, on a small fixture and folders of 10,000
// entries; the 500-node graphs of SR-111 AK6 on fixtures of their own, #1559), under `xvfb-run` on Linux. The nightly perf job and pull requests labelled
// `perf` run it after the Vitest suite (.github/workflows/perf.yml); the required Electron job leaves this folder
// out (test/playwright.config.ts). Each measurement is appended to REQSEQ_PERF_RESULTS, the same file as the
// Vitest suite's, so `scripts/perf/report.mjs` writes one record.
import path from "node:path";
import { defineConfig } from "@playwright/test";

/** `test-results/` at the root of the repository. */
const RESULTS = path.join(import.meta.dirname, "..", "..", "..", "..", "test-results");

// Absolute, so that a run from any folder appends to the record of `pnpm test:perf`.
if ((process.env["REQSEQ_PERF_RESULTS"] ?? "") === "") {
  process.env["REQSEQ_PERF_RESULTS"] = path.join(RESULTS, "perf.jsonl");
}

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // One app at a time, so that measurements do not compete for the cores.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  // Generating and writing 50,000 files takes minutes on a slow runner; a test sets its own bound below this.
  timeout: 600_000,
  outputDir: path.join(RESULTS, "electron-perf"),
  reporter: [["list"], ["junit", { outputFile: path.join(RESULTS, "junit-perf-electron.xml") }]],
});
