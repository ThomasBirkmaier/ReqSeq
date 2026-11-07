// Calm typography of the element (SR-192) on the built app: a centred column of at most 72 characters in a
// wide window, the full width without a sideways scroll in a narrow one, and code alone in a face of fixed
// width. Light-theme screenshots of both widths go to `test-results/electron/screenshots/` (or
// REQSEQ_SCREENSHOTS) for the pull request.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FRONT_MATTER } from "./support/demo.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const shot = async (window: Page, name: string): Promise<void> => {
  await fs.mkdir(OUT, { recursive: true });
  await window.screenshot({ path: path.join(OUT, `${name}.png`) });
};

const TITLE = "Windmessung im Detail";
const LONG_WORD = "Windgeschwindigkeitsmessstationsdatenübertragungsprotokollspezifikation".repeat(2);
const WIDE_ROW = Array.from({ length: 14 }, (_, index) => `Spalte ${String(index + 1)}`);
const TEXT = `# Übersicht

Das Tool muss den Wind messen und \`Code\` in der Zeile zeigen. ${"Ein langer Absatz über den Wind. ".repeat(12)}

${LONG_WORD}

| ${WIDE_ROW.join(" | ")} |
| ${WIDE_ROW.map(() => "---").join(" | ")} |
| ${WIDE_ROW.map(() => "Wert").join(" | ")} |

\`\`\`ts
const wind = 12;
\`\`\`
`;

const FIXTURE = {
  fixture: "SR-069/filter",
  files: { "needs/N-0000000000ed.md": `${DEMO_FRONT_MATTER}${TEXT}` },
};

const resize = async (running: RunningApp, width: number): Promise<void> => {
  await running.app.evaluate(({ BrowserWindow }, w) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(w, 800);
  }, width);
  await expect.poll(() => running.window.evaluate(() => window.innerWidth)).toBe(width);
};

const opened = async (window: Page): Promise<void> => {
  await listAll(window);
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(TITLE);
  await expect(window.locator(".cm-lr-table")).toBeVisible();
};

/** The box of the editor's text, the width of 72 zeros in its face, and the box of its area. */
const measure = (window: Page) =>
  window.evaluate(() => {
    const content = document.querySelector(".element .cm-content");
    const column = document.querySelector(".element .column");
    const area = document.querySelector(".area");
    if (content === null || column === null || area === null) {
      throw new Error("no editor");
    }
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(72);
    probe.style.whiteSpace = "pre";
    content.append(probe);
    const ch72 = probe.getBoundingClientRect().width;
    probe.remove();
    const text = content.getBoundingClientRect();
    const sheet = column.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    // The buffer is the scroller of the element.
    const scroller = document.querySelector(".buffer.element");
    return {
      ch72,
      // The column with the text and, at its right, the space for the copy symbol of the field (SR-128).
      left: sheet.left - box.left,
      right: box.right - sheet.right,
      width: text.width,
      columnWidth: sheet.width,
      areaWidth: box.width,
      sideways: scroller === null ? 1 : scroller.scrollWidth - scroller.clientWidth,
      pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

const fontOf = (window: Page, selector: string): Promise<string> =>
  window.evaluate((at) => {
    const element = document.querySelector(at);
    if (element === null) {
      throw new Error(`nothing at ${at}`);
    }
    return getComputedStyle(element).fontFamily;
  }, selector);

test.describe("the typography of the element text", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-192/AK1] in a window wider than the column the text stands in a centred column of at most 72 characters", async () => {
    await resize(running, 1400);
    await opened(running.window);
    const box = await measure(running.window);
    expect(box.width).toBeLessThanOrEqual(box.ch72 + 1);
    expect(box.width).toBeGreaterThan(box.ch72 * 0.9);
    expect(Math.abs(box.left - box.right)).toBeLessThanOrEqual(2);
    await shot(running.window, "typography-wide");
  });

  test("[SR-192/AK2] in a narrower window the text takes the whole width and wraps without a sideways scroll", async () => {
    await resize(running, 420);
    await opened(running.window);
    const box = await measure(running.window);
    expect(box.width).toBeLessThan(box.ch72);
    // The whole width less the small margin of the sheet on each side and the space of the copy symbol.
    expect(box.columnWidth).toBeGreaterThan(box.areaWidth - 40);
    expect(box.width).toBeGreaterThan(box.columnWidth - 40);
    expect(box.sideways).toBeLessThanOrEqual(0);
    expect(box.pageSideways).toBeLessThanOrEqual(0);
    // The long word wraps inside the column; the wide table scrolls in its own box.
    const table = await running.window.evaluate(() => {
      const element = document.querySelector<HTMLElement>(".cm-lr-table");
      return element === null ? undefined : { scroll: element.scrollWidth, client: element.clientWidth };
    });
    expect(table).toBeDefined();
    expect(table?.scroll ?? 0).toBeGreaterThan(table?.client ?? 0);
    // Its cells break between words only, never inside "Spalte".
    const cellHeights = await running.window
      .locator(".cm-lr-table td")
      .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().height));
    const lineHeight = await running.window
      .locator(".cm-lr-table td")
      .first()
      .evaluate((cell) => parseFloat(getComputedStyle(cell).lineHeight));
    expect(Math.max(...cellHeights)).toBeLessThan(lineHeight * 2);
    await shot(running.window, "typography-narrow");
  });

  test("[SR-192/AK3] code stands in a face of fixed width, all other text, tables included, in a proportional one", async () => {
    await opened(running.window);
    const mono = /monospace/;
    expect(await fontOf(running.window, ".element .cm-lr-code")).toMatch(mono);
    expect(await fontOf(running.window, ".element .cm-lr-codeblock")).toMatch(mono);
    const prose = /system-ui/;
    for (const selector of [".element .cm-content", ".element .cm-lr-h1", ".element .cm-lr-table td"]) {
      const font = await fontOf(running.window, selector);
      expect(font, selector).toMatch(prose);
      expect(font, selector).not.toMatch(mono);
    }
    // The source of the table, shown while the cursor is in it, keeps the text's face.
    await running.window.locator(".cm-lr-table td").first().click();
    await expect(running.window.locator(".cm-lr-table-source").first()).toBeVisible();
    expect(await fontOf(running.window, ".element .cm-lr-table-source")).not.toMatch(mono);
  });
});
