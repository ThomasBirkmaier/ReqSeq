// The command prompt on the built app (SR-108, SR-121): what was chosen for a typed text comes first the next
// time, also after the app restarts. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
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
});
