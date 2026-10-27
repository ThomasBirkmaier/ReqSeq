// The command prompt on the built app (SR-108, SR-121, #85): what was chosen for a typed text comes first the
// next time, also after the app restarts; a catalog command asks its arguments with the values core gives.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS. With LOGREQ_SCREENSHOTS set, the argument
// entry is also saved as a screenshot there.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

const names = (window: Page) => window.locator('.candidates [role="option"] .name');

test.describe("the command prompt", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-121/AK2] a text typed for a command puts that command first the next time, also after a restart", async () => {
    running = await launchApp(FIXTURE);
    let { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    // By match "Filter list by type" is first for "fl".
    await expect(names(window).first()).toHaveText("Filter list by type");
    await window.keyboard.press("ArrowDown");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText(
      "Filter list by status",
    );
    await window.keyboard.press("Enter");
    await expect(window.locator("label.prompt-label")).toHaveText("Status");
    await window.keyboard.press("Escape");
    // The same text now puts the chosen command first.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    await expect(names(window).first()).toHaveText("Filter list by status");
    await window.keyboard.press("Escape");

    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("fl");
    await expect(names(window).first()).toHaveText("Filter list by status");
    // Another text is not changed.
    await window.keyboard.press("Escape");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("flt");
    await expect(names(window).first()).toHaveText("Filter list by type");
  });

  test("a catalog read command asks its arguments in the minibuffer, with the kinds core allows, and shows its output", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    const label = window.locator("label.prompt-label");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Measure wind speed");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Measure wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toContainText("Measure wind speed");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("sro");
    await expect(names(window).first()).toHaveText("Show relation options");
    // Ctrl/Cmd+Enter: the arguments, and then the optional ones.
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("Show relation options · ref:");
    await expect(names(window).first()).toHaveText("SR-0000b1 Measure wind speed");
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(label).toHaveText("Show relation options SR-0000b1 · more arguments:");
    await expect(names(window)).toHaveText(["Run", "kind"]);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(label).toHaveText("Show relation options SR-0000b1 · kind:");
    const options = await running.cli(["relation", "options", "SR-0000b1"]);
    const kinds = (JSON.parse(options.stdout) as { kinds: { name: string }[] }).kinds.map(
      (kind) => kind.name,
    );
    await expect(names(window)).toHaveText(kinds);
    await window.keyboard.type("der");
    const shots = process.env["LOGREQ_SCREENSHOTS"];
    if (shots !== undefined) {
      await window.screenshot({ path: path.join(shots, "catalog-prompt.png") });
    }
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("Show relation options SR-0000b1 Derives from");
    await expect(window.locator(".result .line").first()).toHaveText("kinds1");
    await expect(window.locator(".result")).toContainText("derives-from");
  });
});
