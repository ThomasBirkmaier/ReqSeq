import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ADR-0011: CLI end-to-end tests spawn the built binary (`pnpm build` first), so they run apart from
// the unit tests: `pnpm test:e2e`. On Linux CI the suite runs inside `unshare -rn` (own network
// namespace with only loopback up), on macOS and Windows without it.
// No coverage here: the spawned processes are not measured; the unit tests carry the coverage thresholds (ADR-0016).
export default defineConfig({
  resolve: {
    alias: { "@logreq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/e2e/**/*.test.ts"],
    setupFiles: ["./scripts/test-support/block-network.mjs"],
    env: { LOGREQ_VALIDATE_OUTPUT: "1" },
    // Each test spawns node a few times; slow CI machines need more than the default 5 s.
    testTimeout: 30_000,
    // `agent` prints only failures and the summary: short logs for agents and CI (#392).
    reporters: ["agent", ["junit", { outputFile: "test-results/junit-e2e.xml", addFileAttribute: true }]],
  },
});
