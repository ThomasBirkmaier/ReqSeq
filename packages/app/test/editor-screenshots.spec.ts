// Screenshots of the Markdown editor for the verification record of SR-065 (verification/SR-065.md).
// The window is 1280×800. The PNGs go to `test-results/electron/screenshots/` (or the folder in
// LOGREQ_SCREENSHOTS); copying them to `verification/SR-065/` is a deliberate step, not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp } from "./support/app.js";
import { DEMO_FILES, DEMO_TITLE } from "./support/demo.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Finds the element with `query` in Ctrl+P and opens it; `title` is its full title. */
const openByTitle = async (window: Page, query: string, title = query): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(query);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".cm-content")).toBeVisible();
  // The buffer has the focus once the prompt is gone; its keys (Enter) work from then on.
  await expect(window.locator("article")).toBeFocused();
};

test("screenshots of the editor on a demo element", async () => {
  const running = await launchApp({ fixture: "SR-069/filter", files: DEMO_FILES });
  const { window } = running;
  try {
    await fs.mkdir(OUT, { recursive: true });
    const shot = (name: string): Promise<Buffer> =>
      window.screenshot({ path: path.join(OUT, `${name}.png`) });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByRole("listbox")).toBeVisible();
    await openByTitle(window, DEMO_TITLE);
    const content = window.locator(".cm-content");

    // Not focused: everything is set.
    await expect(content.locator("table.cm-lr-table")).toHaveCount(1);
    await shot("editor-preview");

    // The cursor is in the line with the strong text: that line shows its source.
    await content.locator(".cm-lr-strong").first().click();
    await expect(content).toContainText("**sofort**");
    await shot("editor-cursor-line");

    // The cursor is in the table: its source.
    await content.locator("table.cm-lr-table td").first().click();
    await expect(content.locator("table.cm-lr-table")).toHaveCount(0);
    await shot("editor-table-source");

    // After typing: the modeline says modified.
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.insertText("\n\nNeu: **wichtig**.");
    await expect(window.getByLabel("Modeline")).toContainText("modified");
    await shot("editor-modified");

    // After Ctrl/Cmd+S: saved.
    await window.keyboard.press("ControlOrMeta+s");
    await expect(window.getByLabel("Minibuffer")).toContainText(new RegExp(`^Saved .*${DEMO_TITLE}$`));
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
    await shot("editor-saved");
  } finally {
    await running.close();
  }
});

test("screenshot of the editor on a decision of the specification", async () => {
  const running = await launchApp({ folder: SPEC });
  const { window } = running;
  try {
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByRole("listbox")).toBeVisible();
    await openByTitle(window, "Live-Vorschau", "Text als Markdown mit Live-Vorschau");
    // The inline references read as their text, underlined; the source is not shown.
    await expect(window.locator(".cm-content .cm-lr-link").first()).toBeVisible();
    await window.screenshot({ path: path.join(OUT, "editor-spec-element.png") });
  } finally {
    await running.close();
  }
});
