import { defineConfig } from "vitest/config";

// ADR-0011: one Vitest run for all packages; JUnit output is the evidence record (D-050).
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["./scripts/test-support/block-network.mjs"],
    reporters: ["default", ["junit", { outputFile: "test-results/junit.xml", addFileAttribute: true }]],
  },
});
