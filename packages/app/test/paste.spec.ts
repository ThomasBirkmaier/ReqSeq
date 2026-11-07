// Pasting and dropping as Markdown (SR-190) on the built app: formatted text from the clipboard becomes
// GFM, an address over a selection a link, and a pasted or dropped image a copy next to the element file
// with its reference in the text. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

/** A PNG of one pixel. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const FOLDER = DEMO_FILE.replace(/\.md$/, "");
const NAME = FOLDER.split("/").pop() ?? "";

const FIXTURE = { fixture: "SR-069/filter", files: { [DEMO_FILE]: `${DEMO_FRONT_MATTER}Siehe Quelle.\n` } };

/** Opens the demo element and puts the cursor at the end of its text. */
const editing = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
};

test.describe("pasting and dropping as Markdown", () => {
  let running: RunningApp;
  let before: string;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    before = await running.app.evaluate(({ clipboard }) => clipboard.readText());
    await listAll(running.window);
    await editing(running.window);
  });
  test.afterEach(async () => {
    try {
      await running.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before);
    } finally {
      await running.close();
    }
  });

  const elementFile = (): string => path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/"));
  const read = (): Promise<string> => fs.readFile(elementFile(), "utf8");
  /** Saves at once; the file is polled, since an earlier "Saved" would satisfy a wait on the minibuffer. */
  const save = async (window: Page): Promise<void> => {
    await window.keyboard.press("ControlOrMeta+s");
  };

  test("[SR-190/AK1] formatted text from a browser is written as Markdown, nothing as HTML", async () => {
    const { window, app } = running;
    await window.keyboard.press("Enter");
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([
        new ClipboardItem({
          "text/html":
            '<h2>Wind</h2><p>Die <b>Böe</b> ist <i>kurz</i>, <a href="https://example.org/q">Quelle</a>.</p><ul><li>eins</li><li>zwei</li></ul><table><tr><th>Größe</th><th>Wert</th></tr><tr><td>Böe</td><td>25</td></tr></table><p><img src="https://example.org/w.png" alt="Bild"></p>',
          "text/plain": "Wind",
        }),
      ]);
    });
    await window.keyboard.press("ControlOrMeta+v");
    await save(window);
    await expect
      .poll(read)
      .toContain(
        [
          "## Wind",
          "",
          "Die **Böe** ist *kurz*, [Quelle](https://example.org/q).",
          "",
          "- eins",
          "- zwei",
          "",
          "| Größe | Wert |",
          "| ----- | ---- |",
          "| Böe   | 25   |",
          "",
          "![Bild](https://example.org/w.png)",
        ].join("\n"),
      );
    expect(await read()).not.toMatch(/<\/?[a-z][a-z0-9-]*[\s/>]/i);
    expect(running.stderr()).not.toContain("Blocked a request");
  });

  test("[SR-190/AK2] an address pasted over selected text makes it a Markdown link", async () => {
    const { window, app } = running;
    await window.keyboard.press("ControlOrMeta+Home");
    for (let step = 0; step < 6; step += 1) {
      await window.keyboard.press("ArrowRight");
    }
    for (let step = 0; step < 6; step += 1) {
      await window.keyboard.press("Shift+ArrowRight");
    }
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.writeText("https://example.org/quelle");
    });
    await window.keyboard.press("ControlOrMeta+v");
    await save(window);
    await expect.poll(read).toContain("Siehe [Quelle](https://example.org/quelle).\n");
  });

  test("[SR-190/AK3] a pasted image is copied next to the element file and referred to at the caret", async () => {
    const { window, app } = running;
    await app.evaluate(async ({ clipboard, ClipboardItem }, png) => {
      const blob = new Blob([Buffer.from(png, "base64")], { type: "image/png" });
      await clipboard.write([new ClipboardItem({ "image/png": blob })]);
    }, PNG_BASE64);
    await window.keyboard.press("ControlOrMeta+v");
    await expect(window.locator(".cm-content")).toContainText(`(${NAME}/image.png)`);
    await save(window);
    await expect.poll(read).toContain(`![image](${NAME}/image.png)`);
    const copy = await fs.readFile(
      path.join(running.workspace?.root ?? "", ...FOLDER.split("/"), "image.png"),
    );
    expect(copy.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  test("[SR-190/AK3] a dropped image file is copied and referred to where it was dropped", async () => {
    const { window } = running;
    await window.locator(".cm-content").evaluate((content, png) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "Wind Skizze.png", { type: "image/png" }));
      const line = content.querySelector(".cm-line");
      const box = line?.getBoundingClientRect();
      content.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: (box?.left ?? 0) + 1,
          clientY: (box?.top ?? 0) + 2,
        }),
      );
    }, PNG_BASE64);
    await expect(window.locator(".cm-content")).toContainText(`(${NAME}/Wind-Skizze.png)`);
    await save(window);
    await expect.poll(read).toContain(`![Wind-Skizze](${NAME}/Wind-Skizze.png)Siehe Quelle.`);
    expect(
      await fs.readFile(path.join(running.workspace?.root ?? "", ...FOLDER.split("/"), "Wind-Skizze.png")),
    ).toEqual(Buffer.from(PNG_BASE64, "base64"));
  });
});
