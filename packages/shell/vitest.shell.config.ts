import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The e2e suite of the desktop shell (ADR-0021, Test seam): it starts the e2e build of `reqseq-shell`
// (`pnpm --filter @reqseq/shell build:e2e`) with the CLI built from the checkout (`pnpm build`). On Linux CI it runs
// under Xvfb and a D-Bus session, inside `unshare -rn` (loopback only). Run from the repository root:
// `pnpm --filter @reqseq/shell test:e2e`.
export default defineConfig({
  resolve: {
    alias: { "@reqseq/testkit": fileURLToPath(new URL("../testkit/src/index.ts", import.meta.url)) },
  },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["e2e/**/*.test.ts"],
    // One shell at a time: each starts a window, a server and the engine's processes.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
    reporters: [
      "agent",
      [
        "junit",
        {
          outputFile: fileURLToPath(new URL("../../test-results/junit-shell.xml", import.meta.url)),
          addFileAttribute: true,
        },
      ],
    ],
  },
});
