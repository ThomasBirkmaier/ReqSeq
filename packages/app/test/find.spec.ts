// Find and replace in the element (SR-189) on the built app: the prompts of the minibuffer mark the hits in
// the text while the minibuffer keeps the focus, step through them, replace, and give the text the focus back.
// Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FILES, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

/** Opens the demo element and puts the cursor at the end of its text, on the empty last line. */
const editing = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
};

/** Runs `title` from the command prompt. */
const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toHaveText(new RegExp(`^${title}`));
  await window.keyboard.press("Enter");
};

test.describe("find and replace in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await editing(running.window);
    await running.window.keyboard.type("Quarz eins, Quarz zwei, Quarz drei");
    await running.window.keyboard.press("Home");
  });
  test.afterEach(async () => {
    await running.close();
  });

  const fileText = (): Promise<string> =>
    fs.readFile(path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/")), "utf8");

  const savedText = async (): Promise<string> => {
    await running.window.keyboard.press("ControlOrMeta+s");
    await expect(running.window.getByLabel("Minibuffer")).toContainText("Saved");
    return fs.readFile(path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/")), "utf8");
  };

  test("[SR-189/AK1] Find in element marks every hit; Enter and Shift+Enter step, Escape leaves the caret at the hit", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+f");
    const input = window.getByLabel("Find in element");
    await expect(input).toBeFocused();
    await window.keyboard.type("quarz");
    await expect(window.locator(".cm-lr-find")).toHaveCount(3);
    await expect(window.locator(".cm-lr-find-current")).toHaveCount(1);
    await expect(window.locator(".modeline")).toContainText("1 of 3");
    // The evidence of the PR: the hits marked, the current one outlined, the count in the modeline.
    await window.screenshot({ path: test.info().outputPath("find-hits.png") });
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("2 of 3");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("3 of 3");
    await window.keyboard.press("Shift+Enter");
    await expect(window.locator(".modeline")).toContainText("2 of 3");
    await expect(input).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(window.locator(".cm-lr-find")).toHaveCount(0);
    await expect(window.locator(".cm-content")).toBeFocused();
    // The caret stands at the start of the second hit: typing goes there.
    await window.keyboard.type("X");
    expect(await savedText()).toContain("Quarz eins, XQuarz zwei, Quarz drei\n");
  });

  test("[SR-189/AK2] Replace replaces the current hit and goes to the next", async () => {
    const { window } = running;
    await command(window, "Replace");
    await window.keyboard.type("Quarz");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Replace “Quarz” with")).toBeFocused();
    await window.keyboard.type("Wind");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("1 of 2");
    await window.keyboard.press("Escape");
    await expect(window.locator(".cm-content")).toBeFocused();
    expect(await savedText()).toContain("Wind eins, Quarz zwei, Quarz drei\n");
  });

  const replaceAll = async (window: Page): Promise<void> => {
    await command(window, "Replace all");
    await window.keyboard.type("Quarz");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Wind");
    await window.keyboard.press("Enter");
    await expect(window.locator(".modeline")).toContainText("Replaced 3 hits");
  };

  test("[SR-189/AK3] Replace all replaces every hit and says how many in the status line", async () => {
    const { window } = running;
    await replaceAll(window);
    await expect(window.locator(".cm-content")).toBeFocused();
    expect(await savedText()).toContain("Wind eins, Wind zwei, Wind drei\n");
  });

  test("[SR-189/AK4] after Replace all, one undo takes the whole replacement back", async () => {
    const { window } = running;
    await replaceAll(window);
    expect(await savedText()).toContain("Wind eins, Wind zwei, Wind drei\n");
    await window.keyboard.press("ControlOrMeta+z");
    await expect(window.locator(".cm-content")).toContainText("Quarz eins, Quarz zwei, Quarz drei");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(fileText).toContain("Quarz eins, Quarz zwei, Quarz drei\n");
  });
});
