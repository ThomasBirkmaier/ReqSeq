import { defineConfig } from "vitest/config";

// ADR-0011: one Vitest run for all packages; JUnit output is the evidence record (D-050).
// ADR-0016: 100 % coverage of product code is a required gate.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["./scripts/test-support/block-network.mjs"],
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
