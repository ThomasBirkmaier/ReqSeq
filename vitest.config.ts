import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// ADR-0011: one Vitest run for all packages; JUnit output is the evidence record (D-050).
// ADR-0016: coverage thresholds (100 % per file in core, 80 % per adapter package) are a required gate.
export default defineConfig({
  // Tests use the testkit sources directly, so they need no build of @logreq/testkit first.
  resolve: {
    alias: { "@logreq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    // CLI end-to-end tests spawn the built binary: `pnpm test:e2e` after `pnpm build` (vitest.e2e.config.ts).
    // The performance suite runs apart, nightly and with label `perf`: `pnpm test:perf` (vitest.perf.config.ts).
    // The delivery tests run apart, only in the release workflow: `pnpm test:delivery` (vitest.delivery.config.ts).
    exclude: [
      ...configDefaults.exclude,
      "packages/*/test/e2e/**",
      "packages/*/test/perf/**",
      "packages/*/test/delivery/**",
    ],
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
      // `text` with skipFull lists only the files below 100 %, so a CI log names what is uncovered (#511).
      reporter: ["text-summary", ["text", { skipFull: true }], "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // ADR-0016: every package except the adapters (core with logic and risk, ADR-0002; testkit; any new
      // package) keeps 100 % for every `.ts` file; perFile, so the error names the file. The adapters (cli, api,
      // mcp) and the `.ts` modules of the app need 80 %, aggregated per package: there 100 % mostly produced tests
      // for the number (product owner decision, 2026-10-28, #752). React components (`.tsx`) are reported, but
      // have no threshold: Playwright and the [SR-xxx/AKn] tests are their evidence (product owner decision,
      // 2026-10-27, #537). Vitest checks each glob on its own files and skips a file that no glob matches, so the
      // globs together match every `.ts` file of `include` once. picomatch reads `!(cli|api|mcp|app)` as "does not
      // start with", so the second 100 % glob takes the names that only start with an adapter name (`apps`).
      thresholds: {
        "packages/!(cli|api|mcp|app)/src/**/*.ts": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
          perFile: true,
        },
        "packages/{cli,api,mcp,app}?*/src/**/*.ts": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
          perFile: true,
        },
        "packages/cli/src/**/*.ts": { lines: 80, branches: 80, functions: 80, statements: 80 },
        "packages/api/src/**/*.ts": { lines: 80, branches: 80, functions: 80, statements: 80 },
        "packages/mcp/src/**/*.ts": { lines: 80, branches: 80, functions: 80, statements: 80 },
        "packages/app/src/**/*.ts": { lines: 80, branches: 80, functions: 80, statements: 80 },
      },
    },
  },
});
