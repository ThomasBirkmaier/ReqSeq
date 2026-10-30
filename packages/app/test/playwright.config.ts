// Electron tests (ADR-0011): Playwright drives the built app (`pnpm build:electron`) through
// `_electron.launch`, under `xvfb-run` on Linux. `pnpm test:electron` builds and runs them.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// CI runs the files in shards on Ubuntu and Windows (#303, #412), given as ELECTRON_SHARD=<shard>/<total>, for example 1/2;
// unset or empty runs all files. Playwright's own --shard cuts the sorted list into blocks, and the slow files sort
// first (about 340 s against 190 s for two shards); every <total>-th file per shard evens that out (about 255 s
// against 280 s).
function shardFiles(value: string): RegExp[] {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const shard = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (match === null || shard < 1 || shard > total) {
    throw new Error(`ELECTRON_SHARD must be <shard>/<total> with 1 <= shard <= total, got "${value}"`);
  }
  return readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".spec.ts"))
    .sort()
    .filter((_, index) => index % total === shard - 1)
    .map((file) => exactPath(join(import.meta.dirname, file)));
}

// A glob would read the backslashes of a Windows path as escapes and match nothing (#412), so each file becomes a
// pattern of its whole path that accepts either separator.
function exactPath(file: string): RegExp {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\\|\//g, "[\\\\/]");
  return new RegExp(`^${escaped}$`);
}

const shard = process.env["ELECTRON_SHARD"];
// Absolute paths, so that a file name never also matches a file of the same name in another folder.
const testMatch = shard === undefined || shard === "" ? "**/*.spec.ts" : shardFiles(shard);

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
