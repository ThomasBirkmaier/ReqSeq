// The slash menu of the editor (SR-129) on the built app: the menu next to the caret, the keys, Escape, and
// the Markdown in the file after saving. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import {
  DEMO_FILE,
  DEMO_FILES,
  DEMO_TITLE,
  REFERENCE_FILES,
  REFERENCE_TARGET_ID,
  REFERENCE_TARGET_TITLE,
} from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: { ...DEMO_FILES, ...REFERENCE_FILES } };

const ENTRIES = [
  "Heading 1",
  "Heading 2",
  "Heading 3",
  "Heading 4",
  "Heading 5",
  "Heading 6",
  "Normal text",
  "Bullet list",
  "Numbered list",
  "Task list",
  "Quote",
  "Code block",
  "Table",
  "Link",
  "Reference to element",
  "Image",
  "Math block",
  "Diagram",
  "Bold",
  "Italic",
];

const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Opens the demo element and puts the cursor at the end of its text, on the empty last line. */
const editing = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await expect(window.locator("article")).toBeFocused();
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
};

const menu = (window: Page): Locator => window.locator(".cm-tooltip-autocomplete");
const selectedEntry = (window: Page): Locator =>
  menu(window).locator('li[aria-selected="true"] .cm-completionLabel');
const lastLine = (window: Page): Locator => window.locator(".cm-line").last();

test.describe("the slash menu in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await editing(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-129/AK1] / opens a menu next to the caret with the Markdown elements of the criterion", async () => {
    const { window } = running;
    await window.keyboard.type("/");
    await expect(menu(window)).toBeVisible();
    await expect(menu(window).locator("li .cm-completionLabel")).toHaveText(ENTRIES);
    await expect(menu(window).locator("li")).toHaveCount(ENTRIES.length);
    await expect(menu(window).locator("ul")).toHaveAttribute("role", "listbox");
    // The caret is in the last line, right after the /: the menu is right under that line (above it when
    // the window has no room below), at its start.
    const line = await lastLine(window).boundingBox();
    const box = await menu(window).boundingBox();
    expect(line).not.toBeNull();
    expect(box).not.toBeNull();
    if (line !== null && box !== null) {
      const below = Math.abs(box.y - (line.y + line.height));
      const above = Math.abs(box.y + box.height - line.y);
      expect(Math.min(below, above)).toBeLessThanOrEqual(line.height);
      expect(Math.abs(box.x - line.x)).toBeLessThan(40);
    }
  });

  test("[SR-129/AK1] / in the middle of a word does not open the menu", async () => {
    const { window } = running;
    await window.keyboard.type("und/oder x");
    await expect(menu(window)).toHaveCount(0);
    await expect(lastLine(window)).toHaveText("und/oder x");
  });

  test("[SR-129/AK2] letters narrow the entries as in the command line; Ctrl+N, Ctrl+P and the arrows choose, Enter takes", async () => {
    const { window } = running;
    await window.keyboard.type("/nl");
    await expect(selectedEntry(window)).toHaveText("Numbered list");
    const first = await selectedEntry(window).textContent();
    await window.keyboard.press("Control+n");
    await expect(selectedEntry(window)).not.toHaveText(first ?? "");
    await window.keyboard.press("Control+p");
    await expect(selectedEntry(window)).toHaveText("Numbered list");
    // Ctrl+P is "Go to" in the window; with the menu open it chooses.
    await expect(window.getByLabel("Go to")).toHaveCount(0);
    await window.keyboard.press("ArrowDown");
    await expect(selectedEntry(window)).not.toHaveText("Numbered list");
    await window.keyboard.press("ArrowUp");
    await expect(selectedEntry(window)).toHaveText("Numbered list");
    await window.keyboard.press("Enter");
    await expect(menu(window)).toHaveCount(0);
    await expect(lastLine(window)).toContainText("1.");
    await expect(lastLine(window)).not.toContainText("/nl");
  });

  test("[SR-129/AK2] a fast /h2 and Enter takes Heading 2", async () => {
    const { window } = running;
    await window.keyboard.type("/h2");
    await window.keyboard.press("Enter");
    await window.keyboard.insertText("Zwei");
    await expect(window.locator(".cm-lr-h2").last()).toHaveText("## Zwei");
    await expect(menu(window)).toHaveCount(0);
  });

  test("[SR-129/AK3] Escape closes the menu; the / and the query stay, and the editor keeps the focus", async () => {
    const { window } = running;
    await window.keyboard.type("/b");
    await window.keyboard.type("o");
    await window.keyboard.press("Backspace");
    await expect(menu(window)).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(menu(window)).toHaveCount(0);
    await expect(lastLine(window)).toHaveText("/b");
    await expect(window.locator(".cm-content")).toBeFocused();
    // Typing on does not open it again; a new / does.
    await window.keyboard.type("z");
    await expect(menu(window)).toHaveCount(0);
    await window.keyboard.type(" /");
    await expect(menu(window)).toBeVisible();
  });

  test("[SR-129/AK4] a heading, a table and a reference are in the saved file as CommonMark with GitHub extensions", async () => {
    const { window, workspace } = running;
    await window.keyboard.type("/h2");
    await window.keyboard.press("Enter");
    await window.keyboard.insertText("Neuer Abschnitt");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await window.keyboard.type("/table");
    await window.keyboard.press("Enter");
    // The first header is selected: what is typed replaces it.
    await window.keyboard.insertText("Messwert");
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await window.keyboard.type("/reference");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Insert reference")).toBeVisible();
    await window.keyboard.type(REFERENCE_TARGET_TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(REFERENCE_TARGET_TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("ControlOrMeta+s");
    await expect(window.getByLabel("Minibuffer")).toContainText("Saved");
    const file = await fs.readFile(path.join(workspace?.root ?? "", ...DEMO_FILE.split("/")), "utf8");
    const tail = file.slice(file.indexOf("Link"));
    expect(file).toContain("## Neuer Abschnitt\n");
    expect(file).toContain("| Messwert | Column 2 |\n| --- | --- |\n|  |  |\n");
    expect(file).not.toMatch(/\/(h2|table|reference)/);
    const link = new RegExp(
      `\\[${REFERENCE_TARGET_TITLE}\\]\\(logreq:${REFERENCE_TARGET_ID}\\?version=n1:[0-9a-f]+\\)`,
    );
    expect(file).toMatch(link);
    expect(tail).toBeDefined();
    const html = micromark(file.slice(file.indexOf("## Neuer Abschnitt")), {
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
      allowDangerousProtocol: true,
    });
    expect(html).toContain("<h2>Neuer Abschnitt</h2>");
    expect(html).toContain("<th>Messwert</th>");
    expect(html).toContain(`<a href="logreq:${REFERENCE_TARGET_ID}?version=`);
  });

  test("[SR-129/AK3] Escape in Insert reference leaves the / and the query, and the focus in the editor", async () => {
    const { window } = running;
    await window.keyboard.type("/reference");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Insert reference")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByLabel("Insert reference")).toHaveCount(0);
    await expect(window.locator(".cm-content")).toBeFocused();
    await expect(lastLine(window)).toHaveText("/reference");
  });

  test("[SR-129/AK4] one Ctrl/Cmd+Z undoes a taken entry and brings back the / with its query", async () => {
    const { window } = running;
    await window.keyboard.type("/table");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toContainText("Column 2");
    await window.keyboard.press("ControlOrMeta+z");
    await expect(window.locator(".cm-content")).not.toContainText("Column 2");
    await expect(lastLine(window)).toHaveText("/table");
    await expect(menu(window)).toHaveCount(0);
  });
});

/** The value of a colour token as the browser reports it. */
const tokenColour = (window: Page, token: string): Promise<string> =>
  window.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);

for (const scheme of ["light", "dark"] as const) {
  test(`[SR-129/AK1] the menu uses the colours of the sheet in ${scheme} mode`, async () => {
    const running = await launchApp(FIXTURE, { colorScheme: scheme });
    try {
      const { window } = running;
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      await listAll(window);
      await editing(window);
      await window.keyboard.type("/");
      await expect(menu(window)).toBeVisible();
      const css = async (locator: Locator, property: string): Promise<string> =>
        locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
      expect(await css(menu(window), "background-color")).toBe(await tokenColour(window, "--sheet"));
      expect(await css(menu(window), "color")).toBe(await tokenColour(window, "--text"));
      expect(await css(selectedEntry(window).locator(".."), "background-color")).toBe(
        await tokenColour(window, "--select"),
      );
      expect(await css(selectedEntry(window).locator(".."), "color")).toBe(
        await tokenColour(window, "--text"),
      );
      expect(await css(menu(window).locator(".cm-completionDetail").first(), "color")).toBe(
        await tokenColour(window, "--muted"),
      );
      await fs.mkdir(OUT, { recursive: true });
      await window.screenshot({ path: path.join(OUT, `slash-menu-${scheme}.png`) });
    } finally {
      await running.close();
    }
  });
}
