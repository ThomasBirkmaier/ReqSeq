// Electron tests (ADR-0011): Playwright drives the built app (`pnpm build:electron`) through
// `_electron.launch`, under `xvfb-run` on Linux. `pnpm test:electron` builds and runs them.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // One app at a time: each test starts its own Electron with its own workspace and cache folder.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  // A start takes about a second; the bound only catches a hang (slow Windows runners at night).
  timeout: 60_000,
  outputDir: "../../../test-results/electron",
  reporter: [
    ["list"],
    // Evidence record of the run (D-050), next to junit.xml and junit-e2e.xml.
    ["junit", { outputFile: "../../../test-results/junit-electron.xml" }],
  ],
});
