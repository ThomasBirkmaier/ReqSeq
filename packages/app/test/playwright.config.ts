// Electron tests (ADR-0011): Playwright drives the built app (`pnpm build:electron`) through
// `_electron.launch`, under `xvfb-run` on Linux. `pnpm test:electron` builds and runs them.
import { readdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// The Ubuntu lane of CI runs the files in two shards (#303), given as ELECTRON_SHARD=1 or 2 (unset or empty: all
// files). Playwright's own --shard cuts the sorted list into two halves, and the slow files sort first (about 340 s
// against 190 s); every second file per shard evens that out (about 255 s against 280 s).
const shard = process.env["ELECTRON_SHARD"];
const testMatch =
  shard === undefined || shard === ""
    ? "**/*.spec.ts"
    : readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
        .map((file) => file.split("\\").join("/"))
        .filter((file) => file.endsWith(".spec.ts"))
        .sort()
        .filter((_, index) => index % 2 === Number(shard) - 1);

export default defineConfig({
  testDir: ".",
  testMatch,
  // One app at a time: each test starts its own Electron with its own workspace and cache folder.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  // In CI a run stops after 10 failed tests (#303): when the app does not start at all, every further test would
  // only wait for its timeout and hold the runner for half an hour. The run stays red and names the first failures.
  maxFailures: process.env["CI"] !== undefined ? 10 : 0,
  // A start takes about a second; the bound only catches a hang (slow Windows runners at night).
  timeout: 60_000,
  outputDir: "../../../test-results/electron",
  reporter: [
    ["list"],
    // Evidence record of the run (D-050), next to junit.xml and junit-e2e.xml.
    ["junit", { outputFile: "../../../test-results/junit-electron.xml" }],
  ],
});
