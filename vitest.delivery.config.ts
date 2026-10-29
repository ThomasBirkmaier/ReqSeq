import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ADR-0014, ADR-0011 (#324): the delivery tests install the built artifacts (REQSEQ_DELIVERY_DIR) and inspect
// and start them. Only the release workflow runs them: `pnpm test:delivery`, on Linux inside a network
// namespace with loopback only, as a non-root user (the app starts only with its sandbox on).
// No coverage: the packaged processes are not measured; the unit tests carry the coverage thresholds (ADR-0016).
export default defineConfig({
  resolve: {
    alias: { "@reqseq/testkit": fileURLToPath(new URL("./packages/testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/delivery/**/*.test.ts"],
    setupFiles: ["./scripts/test-support/block-network.mjs"],
    // One delivery at a time: each test unpacks an artifact of about 300 MB and may start the app.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: [
      "agent",
      ["junit", { outputFile: "test-results/junit-delivery.xml", addFileAttribute: true }],
    ],
  },
});
