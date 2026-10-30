// Variants on the built app (SR-042) on fixtures/SR-043/example: variant A „Coast“ (VAR-0000c1)
// replaces K1 by A1, excludes K2 „Measure the wind“ (SR-0000a2) and adds A2; K3 „Measure the rain“
// (SR-0000a3) is a core requirement. The app reaches variant.exclude through the generic command
// prompt (SR-108); the view it gives is read with the CLI (SR-080). Keys use ControlOrMeta, so the
// same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const label = (window: Page) => window.locator("label.prompt-label");
const TITLE = "Exclude requirements from variant";

/** The short IDs of the system requirements in `view` (default A), by the CLI. */
const viewIn = async (running: RunningApp, view = "VAR-0000c1"): Promise<string[]> => {
  const input = { selection: { view, where: { type: ["system-requirement"] } } };
  const result = await running.cli(["element", "list", "--input", JSON.stringify(input), "--json"]);
  expect(result.code, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { elements: { shortId: string }[] }).elements.map((e) => e.shortId);
};

/** Runs variant.exclude from the command prompt for variant A and `ref`, with `undo` when asked. */
const excludeInA = async (window: Page, ref: string, title: string, undo: boolean): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(TITLE);
  await expect(names(window).first()).toHaveText(TITLE);
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText(`${TITLE} · variant:`);
  await window.keyboard.type("Coast");
  await expect(names(window).first()).toHaveText("VAR-0000c1 Coast");
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText(`${TITLE} VAR-0000c1 · refs:`);
  await window.keyboard.type(title);
  await expect(names(window).first()).toHaveText(`${ref} ${title}`);
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText(`${TITLE} VAR-0000c1 ${ref} · refs:`);
  if (undo) {
    // Ctrl/Cmd+Enter ends the list and offers the optional arguments, "Run" first.
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label(window)).toHaveText(`${TITLE} VAR-0000c1 ${ref} · more arguments:`);
    await expect(names(window)).toHaveText(["Run", "undo"]);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(`${TITLE} VAR-0000c1 ${ref} · undo:`);
    await expect(names(window)).toHaveText(["yes", "no"]);
    await window.keyboard.press("Enter");
  }
  // Enter runs it: on the empty input of refs it ends the list, after undo it takes "Run".
  await window.keyboard.press("Enter");
  await expect(window.locator(".result")).toContainText("variants/VAR-0000000000c1.md");
};

test.describe("variant.exclude in the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-043/example" });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-042/AK1] variant.exclude removes K3 from the view of A only", async () => {
    expect(await viewIn(running)).toContain("SR-0000a3");
    await excludeInA(running.window, "SR-0000a3", "Measure the rain", false);
    expect(await viewIn(running)).toEqual(["SR-0000a4", "SR-0000b1", "SR-0000b2"]);
    expect(await viewIn(running, "VAR-0000c2")).toContain("SR-0000a3");
  });

  test("[SR-042/AK6] variant.exclude with undo removes the entry and K2 is back in A", async () => {
    expect(await viewIn(running)).not.toContain("SR-0000a2");
    await excludeInA(running.window, "SR-0000a2", "Measure the wind", true);
    expect(await viewIn(running)).toContain("SR-0000a2");
  });
});
