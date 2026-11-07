// Images in the live preview (SR-184) on the built app: an image of the repository is drawn from the
// `reqseq-file:` protocol in place of its source, below its line while the cursor is in it, and an image on
// the network, outside the repository or missing keeps its source with a quiet note. Keys use ControlOrMeta,
// so the same tests run on Linux and macOS.
import { deflateSync, crc32 } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
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

const FOLDER = DEMO_FILE.replace(/\.md$/, "");
const NAME = FOLDER.split("/").pop() ?? "";
const WIDE = `![wide](${NAME}/wide.png)`;
const REMOTE = "![remote](https://example.org/remote.png)";
const OUTSIDE = "![outside](../../outside.png)";
const MISSING = `![missing](${NAME}/missing.png)`;
const BROKEN = `![broken](${NAME}/broken.png)`;
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

test.describe("images in the live preview", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
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

  test("[SR-184/AK1] an image of the workspace is drawn in place of its source, at most as wide as the text column", async () => {
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

  test("[SR-184/AK2] with the cursor in its line, the source shows and the image is below it", async () => {
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

  test("[SR-184/AK3] an image on the network or outside the repository loads nothing and keeps its source with a note", async () => {
    const { window } = running;
    await expect(line(window, REMOTE)).toContainText(REMOTE);
    await expect(line(window, REMOTE)).toContainText("not shown: address on the network");
    await expect(line(window, REMOTE)).toContainText(OUTSIDE);
    await expect(line(window, REMOTE)).toContainText("not shown: outside the repository");
    expect(running.stderr()).not.toContain("Blocked a request");
    const sources = await window
      .locator(".cm-content img:not(.cm-widgetBuffer)")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).src));
    expect(sources.every((source) => source.startsWith("reqseq-file://workspace/"))).toBe(true);
  });

  test("[SR-184/AK4] a missing image and a file that is no image keep their source with a note", async () => {
    const { window } = running;
    const shown = line(window, MISSING);
    await expect(shown).toContainText(MISSING);
    await expect(shown).toContainText(BROKEN);
    await expect(shown.locator(".cm-lr-image-note", { hasText: "file missing or not an image" })).toHaveCount(
      2,
    );
    await expect(shown.locator("img:not(.cm-widgetBuffer)")).toHaveCount(0);
  });
});
