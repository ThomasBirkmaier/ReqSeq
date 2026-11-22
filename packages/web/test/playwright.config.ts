// UI tests of the web UI (ADR-0020, Tests): Playwright drives Chromium against the UI server, which the fixtures
// start in each worker on a generated workspace (start-ui.ts). The contract tests (`contract-*.spec.ts`, SR-248 and
// SR-078 AK3) also run in Firefox and WebKit, on the Orbit Lab workspace. Build first (`pnpm build`: the pages, and
// the CLI and the test kit the contract tests start), then `pnpm --filter @reqseq/web test:ui`.
import { defineConfig, devices } from "@playwright/test";
import type { Options } from "./fixtures.js";

const CONTRACT = /contract-[^/\\]+\.spec\.ts$/;
const BROWSERS = {
  chromium: "Desktop Chrome",
  firefox: "Desktop Firefox",
  webkit: "Desktop Safari",
} as const;

export default defineConfig<Options>({
  testDir: import.meta.dirname,
  testMatch: "**/*.spec.ts",
  outputDir: "../../../test-results/web",
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["junit", { outputFile: "../../../test-results/junit-web.xml" }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  // Every page runs on each workspace; the tests of the page's foundation and build on the spec copy only.
  projects: [
    { name: "spec", use: { kind: "spec" }, testIgnore: CONTRACT },
    {
      name: "orbit",
      use: { kind: "orbit" },
      testMatch: /(overview|element|routes|changes|evidence|trace|edit|lists)\.spec\.ts$/,
    },
    {
      name: "no-identifier",
      use: { kind: "no-identifier" },
      testMatch: /(overview|element|routes|changes|evidence|trace|edit|lists)\.spec\.ts$/,
    },
    ...Object.entries(BROWSERS).map(([browser, device]) => ({
      name: `contract-${browser}`,
      testMatch: CONTRACT,
      use: { ...devices[device], viewport: { width: 1440, height: 900 }, kind: "orbit" as const },
    })),
  ],
});
