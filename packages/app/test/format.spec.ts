// Formatting the selection (SR-186) on the built app: Ctrl/Cmd+B and Ctrl/Cmd+I in the text, "Bold" and
// "Link" from the command prompt with the selection kept while the prompt is open, and the saved file. Keys
// use ControlOrMeta, so the same tests run on Linux and macOS.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll, saveAndRead } from "./support/app.js";
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

/** Selects the last `count` characters before the caret. */
const selectBack = async (window: Page, count: number): Promise<void> => {
  for (let step = 0; step < count; step += 1) {
    await window.keyboard.press("Shift+ArrowLeft");
  }
};

/** Runs `title` from the command prompt. */
const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
};

test.describe("formatting the selection in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await editing(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** Ctrl/Cmd+S, and the element file holds `text` (autosave may have saved it first: `saveAndRead`). */
  const expectSaved = async (text: string): Promise<void> => {
    await saveAndRead(
      running.window,
      path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/")),
      text,
    );
  };

  test("[SR-186/AK-ykwj] Ctrl/Cmd+B and Ctrl/Cmd+I format the selection in the text, and one undo takes it back", async () => {
    const { window } = running;
    await window.keyboard.type("Wind ");
    await selectBack(window, 5);
    await window.keyboard.press("ControlOrMeta+b");
    await window.keyboard.press("ControlOrMeta+i");
    // The selection stayed on the word: typing replaces it inside the marks.
    await window.keyboard.type("Böe");
    await expect(window.locator(".cm-content")).toBeFocused();
    await expectSaved("***Böe*** \n");
    // The typing, then the italic: the bold stays.
    await window.keyboard.press("ControlOrMeta+z");
    await window.keyboard.press("ControlOrMeta+z");
    await expect(window.locator(".cm-content")).toContainText("**Wind** ");
    await expectSaved("**Wind** \n");
  });

  test("[SR-186/AK-vzm9] Bold from the command prompt formats the selection the text had, and the text keeps the focus", async () => {
    const { window } = running;
    await window.keyboard.type("Böe");
    await selectBack(window, 3);
    await command(window, "Bold");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.type("Sturm");
    await expectSaved("**Sturm**\n");
  });

  test("Ctrl/Cmd+I in the open command prompt leaves the text and the focus of the prompt alone (#1577)", async () => {
    const { window } = running;
    await window.keyboard.type("Wind");
    await selectBack(window, 4);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    const input = window.getByRole("combobox");
    await expect(input).toBeFocused();
    await window.keyboard.press("ControlOrMeta+i");
    await window.keyboard.press("ControlOrMeta+b");
    await expect(input).toBeFocused();
    await expect(window.locator(".cm-content")).toContainText("Wind");
    await expect(window.locator(".cm-content")).not.toContainText("*");
    // Ctrl+N still moves the selection of the prompt, and Escape still ends it.
    await window.keyboard.press("Control+n");
    await expect(window.locator('.candidates [role="option"][aria-selected="true"]')).toHaveCount(1);
    await window.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
  });

  test("[SR-186/AK-gbzd] Link asks for the address and writes the selection as a link to it", async () => {
    const { window } = running;
    await window.keyboard.type("die Norm");
    await selectBack(window, 4);
    await command(window, "Link");
    await expect(window.getByLabel("Link address")).toBeVisible();
    await window.keyboard.insertText("https://example.org/norm");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    await expectSaved("die [Norm](https://example.org/norm)\n");
  });
});
