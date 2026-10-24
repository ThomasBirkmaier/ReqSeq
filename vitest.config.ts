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
    setupFiles: ["./scripts/test-support/block-network.mjs"],
    // ADR-0002 rule 4: command outputs are checked against the catalog in tests (packages/core runtime/invoke.ts).
    env: { LOGREQ_VALIDATE_OUTPUT: "1" },
    reporters: ["default", ["junit", { outputFile: "test-results/junit.xml", addFileAttribute: true }]],
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
