// The test cases and executions in the trace chain on the built app (#224, SR-033): "Show trace chain" on
// the need of `fixtures/SR-033/chain` shows under each requirement its test cases (class name › name) with
// every execution's date and result, and its item under test and evidence document with "Show details" (AK1,
// SR-223 AK2), a test case that was only skipped marked as not executed (AK3), and a record without a test case,
// all as `trace.chain` gives them. On `fixtures/SR-223/runs`, the runs of one test case in the core and in
// variants with one result are one row with date, result and views, and a run whose results differ has a row
// per view (SR-223 AK4). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** "Show details" by its keys: Ctrl+K D, or Cmd+K D on macOS (SR-223 AK2). */
const showDetails = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+K");
  await window.keyboard.press("d");
};

const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');

/** Each line of the result buffer as its label and text, indented two spaces per level. */
const lines = async (window: Page): Promise<string[]> =>
  window.locator(".result .line").evaluateAll((all) =>
    all.map((line) => {
      const depth = Number((line as HTMLElement).dataset["depth"]);
      const label = line.querySelector(".label")?.textContent ?? "";
      return `${"  ".repeat(depth)}${label}|${line.querySelector(".text")?.textContent ?? ""}`;
    }),
  );

/** "Show trace chain" on the element titled `title`, `candidate` its line in the prompt. */
const showChain = async (
  window: Page,
  title = "See the wind",
  candidate = "N-33a001 See the wind",
): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Show trace chain");
  await expect(names(window).first()).toHaveText("Show trace chain");
  await window.keyboard.press("Enter");
  await expect(names(window).first()).toHaveText(candidate);
  await window.keyboard.press("Enter");
  await expect(window.locator(".result .line.element").first()).toHaveText(new RegExp(title, "u"));
};

test.describe("the evidence in the trace chain", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-033/chain" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-033/AK-mvfg] the chain view shows each test case of a requirement with all its executions, with date and result, and item and evidence on request", async () => {
    const { window } = running;
    await showChain(window);
    const shown = await lines(window);
    const at = shown.indexOf("  SR-33b001|Show wind speed");
    expect(at).toBeGreaterThan(-1);
    expect(shown.slice(at, at + 4)).toEqual([
      "  SR-33b001|Show wind speed",
      "    test case|tests.test_wind › test_speed[SR-33b001]",
      "      |2026-10-22T09:00:00Z · failed",
      "      |2026-10-21T09:00:00Z · passed",
    ]);
    // "Show details" adds the item under test and the evidence document under each execution (SR-223 AK2).
    await showDetails(window);
    await expect(window.locator(".result .line.detail").first()).toBeVisible();
    const detailed = await lines(window);
    const from = detailed.indexOf("  SR-33b001|Show wind speed");
    expect(detailed.slice(from + 2, from + 6)).toEqual([
      "      |2026-10-22T09:00:00Z · failed",
      "        |build-513 · system/evidence/ci/run-2.xml:4",
      "      |2026-10-21T09:00:00Z · passed",
      "        |build-512 · system/evidence/ci/run-1.xml:4",
    ]);
    await showDetails(window);
    await expect(window.locator(".result .line.detail")).toHaveCount(0);
    // A record without a test case, with its Beleg as text (never opened).
    const b4 = shown.indexOf("  SR-33b004|Show the wind on the display");
    expect(shown[b4 + 1]).toBe(
      "    record|2026-10-20T14:00:00Z · inspection · passed · Display sample B4 · reports/inspection-b4.pdf",
    );
    // The evidence is under the elements, not a list of its own.
    expect(shown.filter((line) => line.startsWith("evidence|"))).toEqual([]);
  });

  test("[SR-033/AK-jtx6] the chain view marks a test case without execution as not executed", async () => {
    const { window } = running;
    await showChain(window);
    const shown = await lines(window);
    const at = shown.indexOf("  SR-33b003|Show gusts");
    expect(at).toBeGreaterThan(-1);
    expect(shown[at + 1]).toBe("    test case|tests.test_wind › test_gusts[SR-33b003] · not executed");
    // No execution line follows it.
    expect(shown[at + 2]?.startsWith("      ")).toBe(false);
  });
});

test.describe("the runs of a test case in the trace chain", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-223/runs" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-223/AK-st5q] runs of one test case with one result in the core and in variants are one row with date, result and views; a differing result gives a row per view", async () => {
    const { window } = running;
    await showChain(window, "Read the results file", "SR-0000a1 Read the results file");
    const shown = await lines(window);
    const at = shown.findIndex((line) => line.includes("test case|"));
    expect(shown.slice(at, at + 5)).toEqual([
      "    test case|results.test.ts › [SR-0000a1] reads the results file",
      // The newer run: macOS failed, so each view has its own row.
      "      |2026-11-10T10:00:00Z · passed · Core",
      "      |2026-11-10T10:00:00Z · passed · Linux",
      "      |2026-11-10T10:00:00Z · failed · macOS",
      // The older run passed in every view: one row.
      "      |2026-11-09T10:00:00Z · passed · Core, Linux, macOS",
    ]);
    await window.screenshot({ path: path.join(SHOTS, "sr-223-runs-light.png") });
    // "Show details" shows each execution on its own, with its view, item under test and evidence document.
    await showDetails(window);
    await expect(window.locator(".result .line.detail").first()).toBeVisible();
    const detailed = await lines(window);
    const from = detailed.findIndex((line) =>
      line.includes("2026-11-09T10:00:00Z · passed · Core, Linux, macOS"),
    );
    expect(detailed.slice(from + 1, from + 4)).toEqual([
      "        |Core · build-93 (linux) · system/evidence/ci/run-1-linux.xml:4",
      "        |Linux · build-93 (linux) · system/evidence/ci/run-1-linux.xml:4",
      "        |macOS · build-93 (macos) · system/evidence/ci/run-1-macos.xml:4",
    ]);
  });
});
