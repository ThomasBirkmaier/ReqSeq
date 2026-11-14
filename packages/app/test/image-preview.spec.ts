// Images in the live preview (SR-184) on the built app: an image of the repository is drawn from the
// `reqseq-file:` protocol in place of its source, below its line while the cursor is in it, and an image on
// the network, outside the repository or missing keeps its source with a note right after it, muted and
// in smaller type, while the cursor stays and typing goes on. Keys use ControlOrMeta,
// so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

/** A grey PNG of `width` × `height` pixels. */
const png = (width: number, height: number): Uint8Array => {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0x80)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const OUT = fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const FOLDER = DEMO_FILE.replace(/\.md$/, "");
const NAME = FOLDER.split("/").pop() ?? "";
const WIDE = `![wide](${NAME}/wide.png)`;
const REMOTE = "![remote](https://example.org/remote.png)";
const OUTSIDE = "![outside](../../outside.png)";
const MISSING = `![missing](${NAME}/missing.png)`;
const BROKEN = `![broken](${NAME}/broken.png)`;
const NOTES = {
  network: "not shown: address on the network",
  outside: "not shown: outside the repository",
  unreadable: "not shown: file missing or not an image",
};
const TEXT = `Erste Zeile\n\n${WIDE}\n\n${REMOTE} ${OUTSIDE}\n\n${MISSING} ${BROKEN}\n`;

const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    [DEMO_FILE]: `${DEMO_FRONT_MATTER}${TEXT}`,
    [`${FOLDER}/wide.png`]: png(3000, 40),
    [`${FOLDER}/broken.png`]: "no image",
  },
};

const line = (window: Page, text: string) => window.locator(".cm-line", { hasText: text });

const DIALOG = '[role="dialog"], [role="alertdialog"], dialog';

/** The colour `var(--muted)` gives a text: the colour of secondary text, as `[SR-128/AK-sthw]` checks it. */
const mutedColour = (window: Page): Promise<string> =>
  window.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--muted)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });

/** The `nth` note of `shown` stands in the same line directly after `source`, muted and in smaller type. */
const expectNote = async (window: Page, shown: Locator, source: string, nth = 0): Promise<void> => {
  const note = shown.locator(".cm-lr-image-note").nth(nth);
  await expect(note).toBeVisible();
  const placed = await note.evaluate((node) => {
    const row = node.closest(".cm-line") ?? node;
    const range = document.createRange();
    range.setStart(row, 0);
    range.setEndBefore(node);
    // The last character of the source, and the first fragment of the note: where the line wraps (the
    // wider font on Windows), the note's box spans two rows and starts at the left edge of the column.
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let last: Text | undefined;
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if (text.textContent !== "" && node.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_PRECEDING) {
        last = text as Text;
      }
    }
    const end = document.createRange();
    if (last !== undefined) {
      end.setStart(last, last.length - 1);
      end.setEnd(last, last.length);
    }
    const before = [...end.getClientRects()].at(-1);
    const box = node.getClientRects()[0] ?? node.getBoundingClientRect();
    return {
      text: range.toString(),
      gap: box.left - (before?.right ?? Number.NaN),
      overlap: Math.min(box.bottom, before?.bottom ?? 0) - Math.max(box.top, before?.top ?? 0),
      colour: getComputedStyle(node).color,
      size: parseFloat(getComputedStyle(node).fontSize),
      sourceSize: parseFloat(getComputedStyle(row).fontSize),
    };
  });
  expect(placed.text.endsWith(source)).toBe(true);
  // Directly after the source: no more than the note's own margin between them, on the same row.
  expect(placed.gap).toBeGreaterThanOrEqual(0);
  expect(placed.gap).toBeLessThan(12);
  expect(placed.overlap).toBeGreaterThan(0);
  expect(placed.colour).toBe(await mutedColour(window));
  expect(placed.size).toBeLessThan(placed.sourceSize);
};

/** Puts the cursor at the end of the first line of the text. */
const cursorInFirstLine = async (window: Page): Promise<void> => {
  await window.keyboard.press("Enter");
  await window.keyboard.press("ControlOrMeta+Home");
  await window.keyboard.press("End");
  await expect(window.locator('[data-field="Text"] .cm-content')).toBeFocused();
};

test.describe("images in the live preview", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await listAll(running.window);
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(DEMO_TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-184/AK-n2k7] an image of the element's repository is drawn in place of its source, at most as wide as the text column", async () => {
    const { window } = running;
    const image = window.locator('.cm-content img[alt="wide"]');
    await expect(image).toHaveCount(1);
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(3000);
    const widths = await image.evaluate((node) => ({
      image: node.getBoundingClientRect().width,
      column: node.closest(".cm-content")?.getBoundingClientRect().width ?? 0,
    }));
    expect(widths.image).toBeGreaterThan(0);
    expect(widths.image).toBeLessThanOrEqual(widths.column);
    await expect(window.locator(".cm-content")).not.toContainText(WIDE);
  });

  test("[SR-184/AK-h2f8] with the cursor in its line, the source shows and the image is below it", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Home");
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await expect(line(window, WIDE)).toHaveText(WIDE);
    const below = window.locator('.cm-content .cm-lr-image-block img[alt="wide"]');
    await expect(below).toHaveCount(1);
    await expect.poll(() => below.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(3000);
    // The image starts below the source text of its line.
    const sourceBottom = await line(window, WIDE).evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let bottom = 0;
      for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        range.selectNodeContents(text);
        bottom = Math.max(bottom, range.getBoundingClientRect().bottom);
      }
      return bottom;
    });
    const imageTop = await below.evaluate((node) => node.getBoundingClientRect().top);
    expect(imageTop).toBeGreaterThanOrEqual(sourceBottom - 1);
  });

  test("[SR-184/AK-bjm1] an image on the network or outside the repository loads nothing and keeps its source with a note right after it, and typing goes on", async () => {
    const { window } = running;
    const shown = line(window, REMOTE);
    await expect(shown).toHaveText(`${REMOTE}${NOTES.network} ${OUTSIDE}${NOTES.outside}`);
    await expectNote(window, shown, REMOTE, 0);
    await expectNote(window, shown, OUTSIDE, 1);
    expect(running.stderr()).not.toContain("Blocked a request");
    const sources = await window
      .locator(".cm-content img:not(.cm-widgetBuffer)")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).src));
    expect(sources.every((source) => source.startsWith("reqseq-file://workspace/"))).toBe(true);
    // With the cursor in the text no dialog opens, the cursor stays and typing goes on, also over a new
    // image source on the network, whose note appears while it is typed.
    await cursorInFirstLine(window);
    await window.keyboard.type(` ${REMOTE} weiter`);
    const first = line(window, "Erste Zeile");
    await expect(first).toHaveText(`Erste Zeile ${REMOTE}${NOTES.network} weiter`);
    await expectNote(window, first, REMOTE);
    await window.keyboard.type(" mehr");
    await expect(first).toHaveText(`Erste Zeile ${REMOTE}${NOTES.network} weiter mehr`);
    await expect(window.locator(DIALOG)).toHaveCount(0);
  });

  test("[SR-184/AK-vqh4] a missing image and a file that is no image keep their source with a note right after it, also later while the cursor is elsewhere", async () => {
    const { window } = running;
    const shown = line(window, MISSING);
    await expect(shown).toHaveText(`${MISSING}${NOTES.unreadable} ${BROKEN}${NOTES.unreadable}`);
    await expect(shown.locator("img:not(.cm-widgetBuffer)")).toHaveCount(0);
    await expectNote(window, shown, MISSING, 0);
    await expectNote(window, shown, BROKEN, 1);
    // A missing image typed into the first line, then the cursor moves to the next line: the note is there,
    // no dialog opens, and typing goes on at the cursor (a note that comes later: the unit test).
    await cursorInFirstLine(window);
    const late = `![late](${NAME}/late.png)`;
    await window.keyboard.type(` ${late}`);
    await window.keyboard.press("Enter");
    await window.keyboard.type("weiter");
    const first = line(window, "Erste Zeile");
    await expect(first).toHaveText(`Erste Zeile ${late}${NOTES.unreadable}`);
    await expectNote(window, first, late);
    await window.keyboard.type(" mehr");
    await expect(line(window, "weiter")).toHaveText("weiter mehr");
    await expect(window.locator(DIALOG)).toHaveCount(0);
    await fs.mkdir(OUT, { recursive: true });
    await window.locator("article").screenshot({ path: path.join(OUT, "image-notes-light.png") });
  });

  test("screenshot: images in the live preview with notes (light)", async () => {
    const { window } = running;
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.locator('.cm-content img[alt="wide"]')).toBeVisible();
    await window.screenshot({ path: path.join(OUT, "image-preview-light.png") });
  });
});
