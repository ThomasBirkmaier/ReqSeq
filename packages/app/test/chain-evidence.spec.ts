// The test cases and executions in the trace chain on the built app (#224, SR-033): "Show trace chain" on
// the need of `fixtures/SR-033/chain` shows under each requirement its test cases (class name › name) with
// every execution's date, result, item and Beleg (AK1), a test case that was only skipped marked as not
// executed (AK3), and a record without a test case, all as `trace.chain` gives them. Keys use
// ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');

/** Each line of the result buffer as its label and text, indented two spaces per level. */
const lines = async (window: Page): Promise<string[]> =>
  window.locator(".result .line").evaluateAll((all) =>
    all.map((line) => {
      const depth = Math.round((parseFloat((line as HTMLElement).style.paddingLeft) - 0.75) / 1.25);
      const label = line.querySelector(".label")?.textContent ?? "";
      return `${"  ".repeat(depth)}${label}|${line.querySelector(".text")?.textContent ?? ""}`;
    }),
  );

const showChain = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("See the wind");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("See the wind");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText("See the wind");
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Show trace chain");
  await expect(names(window).first()).toHaveText("Show trace chain");
  await window.keyboard.press("Enter");
  await expect(names(window).first()).toHaveText("N-33a001 See the wind");
  await window.keyboard.press("Enter");
  await expect(window.locator(".result .line.element").first()).toHaveText(/See the wind/);
};

test.describe("the evidence in the trace chain", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-033/chain" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-033/AK-mvfg] the chain view shows each test case of a requirement with all its executions, with date, result, item and evidence", async () => {
    const { window } = running;
    await showChain(window);
    const shown = await lines(window);
    const at = shown.indexOf("  SR-33b001|Show wind speed");
    expect(at).toBeGreaterThan(-1);
    expect(shown.slice(at, at + 4)).toEqual([
      "  SR-33b001|Show wind speed",
      "    test case|tests.test_wind › test_speed[SR-33b001]",
      "      |2026-10-22T09:00:00Z · failed · build-513 · system/evidence/ci/run-2.xml:4",
      "      |2026-10-21T09:00:00Z · passed · build-512 · system/evidence/ci/run-1.xml:4",
    ]);
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
