import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// ADR-0011: one Vitest run for all packages; JUnit output is the evidence record (D-050).
// ADR-0016: 100 % coverage of product code is a required gate.
export default defineConfig({
  // Tests use the testkit sources directly, so they need no build of @logreq/testkit first.
  resolve: {
    alias: { "@logreq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    // CLI end-to-end tests spawn the built binary: `pnpm test:e2e` after `pnpm build` (vitest.e2e.config.ts).
    // The performance suite runs apart, nightly and with label `perf`: `pnpm test:perf` (vitest.perf.config.ts).
    exclude: [...configDefaults.exclude, "packages/*/test/e2e/**", "packages/*/test/perf/**"],
    setupFiles: ["./scripts/test-support/block-network.mjs", "./scripts/test-support/dom-selection.mjs"],
    // Worker threads that core starts (ADR-0008) load the TypeScript sources: scripts/test-support/worker-preload.mjs.
    // `--import` takes a URL (a Windows path, C:\..., is no valid specifier). Node strips the types
    // by default only from 22.18; the flag does it on every Node 22 that `engines` allows.
    execArgv: [
      "--experimental-strip-types",
      "--import",
      new URL("./scripts/test-support/worker-preload.mjs", import.meta.url).href,
    ],
    // Most unit tests build Git fixtures and so spawn git many times (core, cli, testkit). On a
    // loaded windows-2025 runner a process start takes 0.1 s to more than 1 s, and such tests went over
    // the default 5 s although nothing hung (#206: tests of SR-004, SR-011, SR-018 and SR-084).
    // 30 s, as in vitest.e2e.config.ts, is several times the slowest passing run seen (about 4.3 s)
    // and still ends a real hang. Hooks build fixtures too, so they get the same bound (default 10 s).
    // Tests with their own timeout keep it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // ADR-0002 rule 4: command outputs are checked against the catalog in tests (packages/core runtime/invoke.ts).
    env: { LOGREQ_VALIDATE_OUTPUT: "1" },
    // `agent` prints only failures and the summary: short logs for agents and CI (#392).
    reporters: ["agent", ["junit", { outputFile: "test-results/junit.xml", addFileAttribute: true }]],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
