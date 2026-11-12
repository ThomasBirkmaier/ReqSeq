// Editing tables in the element buffer (SR-188) on the built app: Tab between cells and into a new row, and
// "Align table" and "Insert column" from the command prompt, with the saved file and one undo. A light-theme
// screenshot of the aligned table is the evidence for the PR.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

const TEXT = "Werte:\n\n| Ort | Wind |\n|---|---:|\n| Nord | 12 |\n| Süd | 7 |\n";

const FIXTURE = { fixture: "SR-069/filter", files: { [DEMO_FILE]: `${DEMO_FRONT_MATTER}${TEXT}` } };

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const open = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
};

const fileText = async (running: RunningApp): Promise<string> => {
  const file = await fs.readFile(path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/")), "utf8");
  return file.slice(file.indexOf("Werte"));
};

/** Saves (Ctrl/Cmd+S, or autosave got there first) and waits until the file holds `expected`. */
const expectSaved = async (running: RunningApp, expected: string | RegExp): Promise<void> => {
  await running.window.keyboard.press("ControlOrMeta+s");
  if (typeof expected === "string") {
    await expect.poll(() => fileText(running)).toBe(expected);
  } else {
    await expect.poll(() => fileText(running)).toMatch(expected);
  }
};

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
};

/** Puts the caret at the end of the row with `text`: a click on its cell when the table is drawn shows its source. */
const caretIn = async (window: Page, text: string): Promise<void> => {
  const cell = window.locator(".cm-lr-table td", { hasText: text });
  if ((await cell.count()) > 0) {
    await cell.click();
  }
  await expect(window.locator(".cm-content")).toBeFocused();
  await expect(window.locator(".cm-line", { hasText: text })).toHaveCount(1);
  await window.locator(".cm-line", { hasText: text }).click();
  await window.keyboard.press("End");
};

test.describe("table editing in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await open(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-188/AK-nnmv] [SR-188/AK-hhdn] Tab after the last cell adds a row, and one undo takes it back", async () => {
    const { window } = running;
    await caretIn(window, "Süd");
    await window.keyboard.press("Tab");
    // The new row, empty, under the last one.
    await expectSaved(running, /\| Süd \| 7 \|\n\| +\| +\|\n$/u);

    await window.locator(".cm-content").focus();
    await window.keyboard.press("ControlOrMeta+z");
    await expectSaved(running, TEXT);
    await caretIn(window, "Süd");
    await window.keyboard.press("Tab");
    await window.keyboard.type("Ost");
    await window.keyboard.press("Tab");
    await window.keyboard.type("3");
    await expectSaved(running, /\| Süd \| 7 \|\n\| Ost +\| 3 *\|\n$/u);
  });

  test("[SR-188/AK-g6sz] [SR-188/AK-fk18] Align table and Insert column from the command prompt change the file", async () => {
    const { window } = running;
    await caretIn(window, "Nord");
    await command(window, "Align table");
    await expectSaved(
      running,
      "Werte:\n\n| Ort  | Wind |\n| ---- | ---: |\n| Nord |   12 |\n| Süd  |    7 |\n",
    );
    await window.keyboard.press("Escape");
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "table-aligned-light.png") });
    await caretIn(window, "Nord");
    await command(window, "Insert column");
    // A third column in the header row.
    await expectSaved(running, /^Werte:\n\n\|[^|\n]*\|[^|\n]*\|[^|\n]*\|\n/u);
  });
});
