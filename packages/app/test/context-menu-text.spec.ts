// The context menu in the text of an element (SR-195) on the built app: its editing and formatting entries,
// Cut and Copy only with text selected (AK1); a right-click inside the selection keeps it, one outside puts
// the caret at the pointer (AK2); Cut, Copy and Paste from the menu and the command line do what the
// system's keys do, an image too (AK3); "Follow reference" first on a reference (AK4); the table actions in
// a cell (AK5); Fold or Unfold section on a heading (AK6). Right-clicks go through Chromium's input
// (Playwright's mouse), and the clipboard is the system's, read and written in main.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

const SOURCE_ID = "69069069-0000-4000-8000-00000000e195";
const SOURCE_FILE = "needs/N-0000000e195.md";
const SOURCE_TITLE = "Windmenü";
const TARGET_ID = "69069069-0000-4000-8000-00000000e196";
const TARGET_TITLE = "Böenmessung";

const TEXT = `# Wind

Siehe [Messung](reqseq:${TARGET_ID}) und die Böe.

| Größe | Wert |
| ----- | ---- |
| Böe   | 25   |

## Leer
`;

const need = (id: string, title: string, text: string): string =>
  `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: ${title}\n---\n\n${text}`;

const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    [SOURCE_FILE]: need(SOURCE_ID, SOURCE_TITLE, TEXT),
    "needs/N-0000000e196.md": need(TARGET_ID, TARGET_TITLE, "Jede Sekunde.\n"),
  },
};

/** A PNG of one pixel. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const AK1 = ["Paste", "Bold", "Italic", "Inline code", "Link", "Insert image"];
const TABLE = ["Insert row", "Delete row", "Insert column", "Delete column", "Align table"];
const ALL = "All commands…";

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entries = (window: Page): Locator => menu(window).getByRole("menuitem");
const entryNames = (window: Page): Promise<string[]> => entries(window).locator(".name").allTextContents();
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"]');
const content = (window: Page): Locator => window.locator(".cm-content").first();
/** The rendered text of the editor, without the source marks of the lines off the caret. */
const line = (window: Page, text: string): Locator => content(window).locator(".cm-line", { hasText: text });

/** Where the first occurrence of `text` is drawn in `within`: the middle of the word, or its left edge. */
const pointOf = (
  within: Locator,
  text: string,
  edge = false,
): Promise<{ readonly x: number; readonly y: number }> =>
  within.evaluate(
    (root, { word, left }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(word) ?? -1;
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + word.length);
          const box = range.getBoundingClientRect();
          return { x: left ? box.left + 1 : box.left + box.width / 2, y: box.top + box.height / 2 };
        }
      }
      throw new Error(`"${word}" is not shown`);
    },
    { word: text, left: edge },
  );

/**
 * Right-clicks the first occurrence of `text` in the editor, in the middle of the word (at its left edge
 * with `edge`), and waits for the menu.
 */
const rightClickOn = async (
  window: Page,
  text: string,
  within: Locator = content(window),
  edge = false,
): Promise<void> => {
  const point = await pointOf(within, text, edge);
  await window.mouse.click(point.x, point.y, { button: "right" });
  await expect(menu(window)).toBeVisible();
};

/** Clicks the entry `name` of the open menu with the left button. */
const choose = async (window: Page, name: string): Promise<void> => {
  await entries(window)
    .filter({ hasText: new RegExp(`^${name}`) })
    .first()
    .click();
  await expect(menu(window)).toBeHidden();
};

/** Runs `name` from the command prompt, as a person does: Ctrl/Cmd+Shift+P, the name, Enter. */
const fromCommandLine = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(name);
  await expect(candidates(window).first().locator(".name")).toHaveText(name);
  await window.keyboard.press("Enter");
};

/**
 * Selects the word `word` on line `row` of the text with a double click, as a person does; the caret goes to
 * that line first, so the line shows its source before the word is measured.
 */
const select = async (window: Page, word: string, row: number): Promise<void> => {
  await content(window).focus();
  await window.keyboard.press("ControlOrMeta+Home");
  for (let step = 1; step < row; step += 1) {
    await window.keyboard.press("ArrowDown");
  }
  const point = await pointOf(content(window), word);
  await window.mouse.dblclick(point.x, point.y);
  await expect.poll(() => window.evaluate(() => document.getSelection()?.toString())).toBe(word);
};

test.describe("the context menu in the text", () => {
  let running: RunningApp;
  let clipboard: string;

  const file = (): string => path.join(running.workspace?.root ?? "", ...SOURCE_FILE.split("/"));
  const read = (): Promise<string> => fs.readFile(file(), "utf8");
  const readClipboard = (): Promise<string> => running.app.evaluate(({ clipboard }) => clipboard.readText());
  const writeClipboard = (text: string): Promise<void> =>
    running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);

  test.beforeEach(async () => {
    const light = test.info().title.includes("screenshot");
    running = await launchApp(FIXTURE, light ? { colorScheme: "light" } : {});
    clipboard = await readClipboard();
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(SOURCE_TITLE);
    await expect(candidates(window).first()).toContainText(SOURCE_TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1").first()).toHaveText(SOURCE_TITLE);
  });

  test.afterEach(async () => {
    try {
      await writeClipboard(clipboard);
    } finally {
      await running.close();
    }
  });

  test("[SR-195/AK-y58z] a right-click in the text offers editing and formatting, Cut and Copy only with text selected", async () => {
    const { window } = running;
    await rightClickOn(window, "Siehe");
    expect(await entryNames(window)).toEqual([...AK1, ALL]);
    await window.keyboard.press("Escape");
    await select(window, "Böe", 3);
    await rightClickOn(window, "Böe.");
    expect(await entryNames(window)).toEqual(["Cut", "Copy", ...AK1, ALL]);
    // Each with the name and key of the command prompt.
    const hints = await entries(window).evaluateAll((items) =>
      items.map((item) => item.querySelector(".hint")?.textContent ?? ""),
    );
    const mod = process.platform === "darwin" ? "⌘" : "Ctrl+";
    expect(hints.slice(0, 5)).toEqual([`${mod}X`, `${mod}C`, `${mod}V`, `${mod}B`, `${mod}I`]);
  });

  test("[SR-195/AK-rm5c] a right-click keeps the selection it lands in, and elsewhere puts the caret at the pointer", async () => {
    const { window } = running;
    await select(window, "Böe", 3);
    // Inside the selection: it stays, and Bold acts on it.
    await rightClickOn(window, "Böe.");
    expect(await window.evaluate(() => document.getSelection()?.toString())).toBe("Böe");
    await choose(window, "Bold");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).toContain("und die **Böe**.");
    // Outside a selection: the caret goes to the word under the pointer, and Italic formats that word.
    await select(window, "und", 3);
    await rightClickOn(window, "Siehe");
    expect(await window.evaluate(() => document.getSelection()?.toString())).toBe("");
    await choose(window, "Italic");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).toContain("*Siehe* [Messung]");
    await expect.poll(read).toContain(") und die **Böe**.");
  });

  test("[SR-195/AK-qn9f] Cut, Copy and Paste from the menu and the command line do what the system's keys do", async () => {
    const { window } = running;
    // Copy from the menu: the selection is on the clipboard, the text unchanged.
    await select(window, "Böe", 3);
    await rightClickOn(window, "Böe.");
    await choose(window, "Copy");
    await expect.poll(readClipboard).toBe("Böe");
    // Cut from the command line: on the clipboard, and gone from the text.
    await select(window, "und", 3);
    await fromCommandLine(window, "Cut");
    await expect.poll(readClipboard).toBe("und");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).toContain(")  die Böe.");
    // Paste from the menu, at the pointer: what Ctrl/Cmd+V gives.
    await writeClipboard("Sturm ");
    await rightClickOn(window, "Siehe", content(window), true);
    await choose(window, "Paste");
    await expect(line(window, "Sturm Siehe")).toHaveCount(1);
    // Paste from the command line, at the caret, which the prompt left in the text.
    await writeClipboard("Wind ");
    await fromCommandLine(window, "Paste");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).toContain("\nSturm Wind Siehe [Messung]");
  });

  test("[SR-195/AK-qn9f] Paste from the menu copies an image from the clipboard as in SR-190", async () => {
    const { window, app } = running;
    await app.evaluate(async ({ clipboard: system, ClipboardItem }, png) => {
      const blob = new Blob([Buffer.from(png, "base64")], { type: "image/png" });
      await system.write([new ClipboardItem({ "image/png": blob })]);
    }, PNG_BASE64);
    await rightClickOn(window, "Siehe");
    await choose(window, "Paste");
    const folder = path.basename(SOURCE_FILE, ".md");
    await expect(content(window)).toContainText(`(${folder}/image.png)`);
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).toContain(`![image](${folder}/image.png)`);
    const copy = await fs.readFile(path.join(path.dirname(file()), folder, "image.png"));
    // The system clipboard encodes the image again: a PNG, as Ctrl/Cmd+V gives it (SR-190 AK3).
    expect(copy.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  test("[SR-195/AK-cqgh] on a reference to an element, Follow reference is the first entry and opens it", async () => {
    const { window } = running;
    await rightClickOn(window, "Siehe");
    expect(await entryNames(window)).not.toContain("Follow reference");
    await window.keyboard.press("Escape");
    await rightClickOn(window, "Messung");
    expect((await entryNames(window))[0]).toBe("Follow reference");
    await choose(window, "Follow reference");
    await expect(window.locator("article h1").first()).toHaveText(TARGET_TITLE);
  });

  test("[SR-195/AK-s8c5] in a table cell the menu adds the table actions, which act on that cell", async () => {
    const { window } = running;
    // The table is drawn while the caret is elsewhere: the right-click goes to the cell of the drawing.
    await rightClickOn(window, "25", window.locator(".cm-lr-table"));
    expect(await entryNames(window)).toEqual([...AK1, ...TABLE, ALL]);
    await choose(window, "Insert column");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).toContain("| Böe   | 25   |  |\n");
    // In the shown source the menu has them too: Delete column takes the cell's column again.
    await rightClickOn(window, "25");
    expect(await entryNames(window)).toEqual([...AK1, ...TABLE, ALL]);
    await rightClickOn(window, "Wert");
    await choose(window, "Delete column");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).not.toContain("Wert");
  });

  test("[SR-195/AK-z4cg] on a heading the menu adds Fold section, and Unfold section once it is folded", async () => {
    const { window } = running;
    await rightClickOn(window, "Wind");
    expect(await entryNames(window)).toEqual([...AK1, "Fold section", ALL]);
    await choose(window, "Fold section");
    await expect(content(window).locator(".cm-lr-fold-hint")).toHaveCount(1);
    await expect(line(window, "Siehe")).toHaveCount(0);
    await rightClickOn(window, "Wind");
    expect(await entryNames(window)).toEqual([...AK1, "Unfold section", ALL]);
    await choose(window, "Unfold section");
    await expect(line(window, "Siehe")).toHaveCount(1);
    // Below the heading, and on a heading with nothing under it, neither.
    await rightClickOn(window, "Siehe");
    expect(await entryNames(window)).toEqual([...AK1, ALL]);
    await window.keyboard.press("Escape");
    await rightClickOn(window, "Leer");
    expect(await entryNames(window)).toEqual([...AK1, ALL]);
  });

  test("the menu in the text in light, as a screenshot", async () => {
    const { window } = running;
    await select(window, "Böe", 3);
    await rightClickOn(window, "Böe.");
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-text-light.png") });
  });
});
