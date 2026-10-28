// Formulas in the editor's live preview (SR-096, #108) on the built app: typed with real keys, set by the
// bundled KaTeX with its own fonts, offline, and with a syntax error the error and the source. SR-096 is
// verified by demonstration; these tests back the record. Keys use ControlOrMeta, so they run on Linux and
// macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FILES, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

const opened = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".cm-content")).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

/** Edits the text of the open element with the caret at its end (Enter on the element). */
const edit = async (window: Page): Promise<Locator> => {
  await window.keyboard.press("Enter");
  const content = window.locator(".cm-content");
  await expect(content).toBeFocused();
  return content;
};

/** Types `lines` with real keys, one Enter between them. */
const typeLines = async (window: Page, lines: readonly string[]): Promise<void> => {
  for (const [at, line] of lines.entries()) {
    if (at > 0) {
      await window.keyboard.press("Enter");
    }
    await window.keyboard.type(line);
  }
};

/** Whether the page loaded the font `family` (from the app's own files). */
const fontLoaded = (window: Page, family: string): Promise<boolean> =>
  window.evaluate(async (name) => {
    await document.fonts.ready;
    return [...document.fonts].some((font) => font.family === name && font.status === "loaded");
  }, family);

test.describe("formulas in the editor", () => {
  let running: RunningApp;
  const consoleProblems: string[] = [];
  test.beforeEach(async () => {
    consoleProblems.length = 0;
    running = await launchApp(FIXTURE);
    running.window.on("console", (message) => {
      if (/Content Security Policy|Refused to|quirks mode/i.test(message.text())) {
        consoleProblems.push(message.text());
      }
    });
    await listAll(running.window);
  });
  test.afterEach(async () => {
    expect(consoleProblems).toEqual([]);
    expect(running.stderr()).not.toContain("Blocked a request");
    await running.close();
  });

  test("[SR-096/AK1] a LaTeX formula typed in the editor appears set", async () => {
    const { window, workspace } = running;
    await opened(window, DEMO_TITLE);
    const content = await edit(window);
    // A short text, so every line is in the window of the test.
    await window.keyboard.press("ControlOrMeta+a");
    await window.keyboard.press("Backspace");

    // An inline formula: on the cursor line its source shows (D-061); with the caret inside it, the set
    // formula appears under it (A1).
    await typeLines(window, ["Energie $E = mc^2$ hier"]);
    const line = content.locator(".cm-line", { hasText: "Energie" });
    await expect(line).toContainText("$E = mc^2$");
    for (let step = 0; step < " hier".length + 2; step += 1) {
      await window.keyboard.press("ArrowLeft");
    }
    const tooltip = window.locator(".cm-tooltip.cm-lr-formula-tooltip");
    await expect(tooltip.locator(".katex")).toBeVisible();
    await expect(tooltip.locator('annotation[encoding="application/x-tex"]')).toHaveText("E = mc^2");

    // A block formula: while the cursor is in it, its source shows and the set formula directly below it,
    // following the typing (A1).
    await window.keyboard.press("End");
    await typeLines(window, ["", "", "$$", "\\frac{a}{b} + \\bigg( x \\bigg)", "$$"]);
    const block = content.locator(".cm-lr-formula-block");
    await expect(block.locator(".katex-display")).toBeVisible();
    await expect(block.locator('annotation[encoding="application/x-tex"]')).toHaveText(
      "\\frac{a}{b} + \\bigg( x \\bigg)",
    );
    await expect(content).toContainText("\\frac{a}{b}");
    await window.keyboard.press("ArrowUp");
    await window.keyboard.press("End");
    await window.keyboard.type(" + c");
    await expect(block.locator('annotation[encoding="application/x-tex"]')).toHaveText(
      "\\frac{a}{b} + \\bigg( x \\bigg) + c",
    );

    // The cursor leaves the text: every formula is set, no `$` and no TeX source is visible.
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
    await expect(tooltip).toHaveCount(0);
    await expect(line.locator(".cm-lr-formula .katex")).toBeVisible();
    await expect(line).not.toContainText("$");
    await expect(content.locator(".cm-line", { hasText: "\\frac" })).toHaveCount(0);
    await expect(content.locator(".cm-lr-formula-block .katex-display")).toBeVisible();

    // Its fonts come from the app (`app:`), none is inlined or blocked (the large delimiter is KaTeX_Size3).
    expect(await fontLoaded(window, "KaTeX_Main")).toBe(true);
    expect(await fontLoaded(window, "KaTeX_Size3")).toBe(true);

    // A click on the set formula puts the cursor there: its source shows again.
    await content.locator(".cm-lr-formula-block").click();
    await expect(content.locator(".cm-line", { hasText: /^\\frac/ })).toHaveCount(1);

    // The file holds the Markdown as typed (D-027): the preview only decorates it. Autosave writes it.
    const file = path.join((workspace as { root: string }).root, ...DEMO_FILE.split("/"));
    await expect
      .poll(() => fs.readFile(file, "utf8"))
      .toBe(`${DEMO_FRONT_MATTER}Energie $E = mc^2$ hier\n\n$$\n\\frac{a}{b} + \\bigg( x \\bigg) + c\n$$\n`);
  });

  test("[SR-096/AK3] a formula with a syntax error shows the error and its source", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await edit(window);
    await typeLines(window, ["", "Bruch $\\frac{1}{$ offen", "", "$$", "\\sqrt{2", "$$"]);
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();

    // Inline: the source stays, the error follows it in grey.
    const line = content.locator(".cm-line", { hasText: "Bruch" });
    await expect(line).toContainText("$\\frac{1}{$");
    await expect(line.locator(".cm-lr-render-error")).toContainText(/Error\s*KaTeX parse error: /);
    // Block: the source lines stay, the error is below them (the message quotes the source too).
    await expect(content.locator(".cm-line", { hasText: /^\\sqrt\{2$/ })).toHaveCount(1);
    await expect(content.locator(".cm-line", { hasText: /^\$\$/ })).toHaveCount(2);
    const blockError = content.locator("div.cm-lr-render-error");
    await expect(blockError).toContainText(/Error\s*KaTeX parse error: /);
    await expect(content.locator(".katex")).toHaveCount(0);
    // Grey, not a colour of meaning (D-062).
    const colours = await blockError.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--muted)";
      element.parentElement?.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(element).color, muted];
    });
    expect(colours[0]).toBe(colours[1]);
  });

  test("a formula runs nothing from the file: untrusted commands are drawn as grey text", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = await edit(window);
    await typeLines(window, [
      "",
      "Link $\\href{javascript:window.hacked=1}{x} \\url{https://example.org} \\htmlClass{evil}{y}$ Ende",
    ]);
    await window.keyboard.press("Escape");
    const formula = content.locator(".cm-lr-formula");
    await expect(formula.locator(".katex")).toBeVisible();
    await expect(formula.locator("a")).toHaveCount(0);
    await expect(formula.locator(".evil")).toHaveCount(0);
    await formula.click();
    expect(await window.evaluate(() => Reflect.get(window, "hacked") as unknown)).toBeUndefined();
  });
});
