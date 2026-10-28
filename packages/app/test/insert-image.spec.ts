// Inserting an image in the editor (SR-097) on the built app: "Insert image" from the command prompt and
// the slash menu's "Image" copy a file through `element.addAttachment`, and the saved text embeds the copy
// in the folder named like the element file, next to it, relatively. Keys use ControlOrMeta, so the same
// tests run on Linux and macOS.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FILES, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

/** A PNG of one pixel. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** The folder of the element's images: the element file without `.md`, next to it. */
const IMAGE_FOLDER = DEMO_FILE.replace(/\.md$/, "");
const FOLDER_NAME = path.posix.basename(IMAGE_FOLDER);

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

/** The image sources of `markdown` as a Git server shows the file (CommonMark with GitHub extensions). */
const imageSources = (markdown: string): string[] =>
  [
    ...micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }).matchAll(
      /<img src="([^"]*)"/g,
    ),
  ].map((match) => decodeURIComponent(match[1] ?? ""));

test.describe("inserting an image in the element buffer", () => {
  let running: RunningApp;
  let source: string;
  let outside: string;
  test.beforeEach(async () => {
    // The image lies outside the workspace, as a screenshot in a download folder does.
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-image-")));
    source = path.join(outside, "Wind Skizze.png");
    await fs.writeFile(source, PNG);
    await fs.writeFile(path.join(outside, "notes.txt"), "no image");
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await editing(running.window);
  });
  test.afterEach(async () => {
    try {
      await running.close();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  const elementFile = (): string => path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/"));

  test("[SR-097/AK1] Insert image copies the file next to the element file, and the saved text refers to it relatively", async () => {
    const { window } = running;
    await window.keyboard.type("Skizze: ");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Insert image");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Insert image");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Insert image")).toBeVisible();
    await window.keyboard.insertText(source);
    await window.keyboard.press("Enter");
    const markdown = `![Wind-Skizze](${FOLDER_NAME}/Wind-Skizze.png)`;
    await expect(window.locator(".cm-content")).toContainText(markdown);
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("ControlOrMeta+s");
    await expect(window.getByLabel("Minibuffer")).toContainText("Saved");

    const file = await fs.readFile(elementFile(), "utf8");
    expect(file).toContain(`Skizze: ${markdown}\n`);
    const copy = path.join(running.workspace?.root ?? "", ...IMAGE_FOLDER.split("/"), "Wind-Skizze.png");
    expect(await fs.readFile(copy)).toEqual(PNG);
    // The original stays where it was.
    expect(await fs.readFile(source)).toEqual(PNG);
  });

  test("[SR-097/AK2] the inserted image is found from the element file, as a text editor or a Git server resolves it", async () => {
    const { window } = running;
    await window.keyboard.type("/image");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Insert image")).toBeVisible();
    await window.keyboard.insertText(source);
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toContainText(`(${FOLDER_NAME}/Wind-Skizze.png)`);
    await expect(window.locator(".cm-content")).not.toContainText("/image");
    await window.keyboard.press("ControlOrMeta+s");
    await expect(window.getByLabel("Minibuffer")).toContainText("Saved");

    const sources = imageSources(await fs.readFile(elementFile(), "utf8"));
    expect(sources).toEqual([`${FOLDER_NAME}/Wind-Skizze.png`]);
    const found = path.resolve(path.dirname(elementFile()), ...(sources[0] ?? "").split("/"));
    expect(await fs.readFile(found)).toEqual(PNG);
  });

  test("a file that is no image is refused with core's message, and the text keeps the / as typed", async () => {
    const { window } = running;
    await window.keyboard.type("/image");
    await window.keyboard.press("Enter");
    await window.keyboard.insertText(path.join(outside, "notes.txt"));
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer")).toContainText("notes.txt");
    await expect(window.locator(".cm-line").last()).toHaveText("/image");
    await expect(window.locator(".cm-content")).toBeFocused();
    await expect(
      fs.stat(path.join(running.workspace?.root ?? "", ...IMAGE_FOLDER.split("/"))),
    ).rejects.toThrow();
  });
});
