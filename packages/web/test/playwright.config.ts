// UI tests of the web UI (ADR-0020, Tests): Playwright drives Chromium against the UI server, which the fixtures
// start in each worker on a generated workspace (start-ui.ts). Build the pages first:
// `pnpm --filter @reqseq/web build && pnpm --filter @reqseq/web test:ui`.
import { defineConfig, devices } from "@playwright/test";
import type { Options } from "./fixtures.js";

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
    { name: "spec", use: { kind: "spec" } },
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
  ],
});
