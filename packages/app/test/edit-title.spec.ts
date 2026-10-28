// The title of an element is edited in its heading (#621; SR-104, SR-073 AK1; spec question #676) on the
// built app: entered with the keyboard or a click, saved a second after the last key or with Ctrl/Cmd+S as
// `title` (SR-105), an emptied title saved with core's hint (SR-064 AK2), a change of the file under the input
// resolved like a box (SR-106 AK2), and the page does not move when the editor comes. Every result is
// compared with the file of the workspace and with the CLI (SR-080). Keys use ControlOrMeta.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };
/** SR-0000b1 "Measure wind speed" and its file. */
const ELEMENT = "SR-0000b1";
const TITLE = "Measure wind speed";
const TEXT = "b1: derives from N1, in package P1.";
const FILE = path.join("requirements", "SR-0000000000b1.md");

const field = (window: Page, label: string): Locator => window.locator(`[data-field="${label}"]`);
const heading = (window: Page): Locator => window.locator("article h1");
const titleContent = (window: Page): Locator => field(window, "Title").locator(".cm-content");
const textContent = (window: Page): Locator => field(window, "Text").locator(".cm-content");
const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const minibuffer = (window: Page): Locator => window.getByLabel("Minibuffer");

/** Opens the element with "Go to"; the element has the focus. */
const opened = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(TITLE);
  await window.keyboard.press("Enter");
  await expect(heading(window)).toHaveText(TITLE);
  await expect(textContent(window)).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

/** Enter on the field of the title: the caret at the end of the title, in its heading. */
const enterTitle = async (window: Page): Promise<void> => {
  await field(window, "Title").focus();
  await window.keyboard.press("Enter");
  // The editor comes with two renders: keys before it would go to the field.
  await expect(titleContent(window)).toBeFocused();
};

/** The title of the element as the CLI reads it. */
const cliTitle = async (running: RunningApp): Promise<string> => {
  const result = await running.cli(["element", "get", ELEMENT]);
  expect(result.code).toBe(0);
  return (JSON.parse(result.stdout) as { element: { title: string } }).element.title;
};

/** The number of hints the modeline counts. */
const hintCount = async (window: Page): Promise<number> =>
  Number(/(\d+) hints?/.exec((await modeline(window).textContent()) ?? "")?.[1] ?? "0");

/** "Resolve change on disk" from the command prompt, and the choice `name`. */
const resolve = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Resolve change on disk");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Resolve change on disk");
  await window.keyboard.press("Enter");
  await window.keyboard.type(name);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(name);
  await window.keyboard.press("Enter");
};

/** The box of a locator; it must be shown. */
const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();
  if (found === null) {
    throw new Error("not shown");
  }
  return found;
};

test.describe("the title of an element, edited in its heading (#621)", () => {
  let running: RunningApp;
  let file: string;
  const onDisk = (): Promise<string> => fs.readFile(file, "utf8");
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    file = path.join(running.workspace?.root ?? "", FILE);
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-105/AK1] keyboard only: Tab to the title, Enter, a new title, Enter, and a second later the file has it; only its line changed", async () => {
    const { window } = running;
    await opened(window);
    const before = await onDisk();
    // Tab from the element: past the links of the parents line to the field of the title.
    for (let tab = 0; tab < 6; tab += 1) {
      if (await field(window, "Title").evaluate((node) => node === document.activeElement)) {
        break;
      }
      await window.keyboard.press("Tab");
    }
    await expect(field(window, "Title")).toBeFocused();
    await expect(heading(window).locator(".cm-editor")).toHaveCount(0);
    await window.keyboard.press("Enter");
    await expect(titleContent(window)).toBeFocused();
    await window.keyboard.type(" now");
    await window.keyboard.press("Enter");
    await expect(field(window, "Title")).toBeFocused();
    await expect.poll(onDisk).toContain(`title: ${TITLE} now\n`);
    const after = await onDisk();
    expect(after).toBe(before.replace(`title: ${TITLE}\n`, `title: ${TITLE} now\n`));
    expect(await cliTitle(running)).toBe(`${TITLE} now`);
    await expect(heading(window)).toHaveText(`${TITLE} now`);
    await expect(modeline(window)).not.toContainText("modified");
  });

  test("Up at the first line of the text goes into the title, Down back into the text, Escape leaves the title for its field", async () => {
    const { window } = running;
    await opened(window);
    await window.keyboard.press("Enter");
    await expect(textContent(window)).toBeFocused();
    await window.keyboard.press("ControlOrMeta+Home");
    await window.keyboard.press("ArrowUp");
    await expect(titleContent(window)).toBeFocused();
    await window.keyboard.type("!");
    await expect(titleContent(window)).toHaveText(`${TITLE}!`);
    await window.keyboard.press("ArrowDown");
    await expect(textContent(window)).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await expect(titleContent(window)).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(field(window, "Title")).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
    await expect.poll(onDisk).toContain(`title: ${TITLE}!\n`);
  });

  test('[SR-064/AK2] an emptied title is saved as title: "" with the hint: Saved names it, the modeline counts one hint more, the heading shows the short ID', async () => {
    const { window } = running;
    await opened(window);
    const hints = await hintCount(window);
    await enterTitle(window);
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.press("Backspace");
    await expect(titleContent(window)).toHaveText(ELEMENT);
    await window.keyboard.press("ControlOrMeta+S");
    await expect(minibuffer(window)).toContainText(/^Saved .*Required property Title \(title\)/);
    await expect.poll(onDisk).toContain('title: ""\n');
    expect(await cliTitle(running)).toBe("");
    await expect.poll(() => hintCount(window)).toBe(hints + 1);
    await expect(heading(window)).toHaveText(ELEMENT);
  });

  test('[SR-106/AK2] input in the title and the file changed outside: nothing is saved, "On disk" shows the file\'s title, and "Keep my input" writes the typed title while the outside change of the text stays', async () => {
    const { window } = running;
    await opened(window);
    await enterTitle(window);
    await window.keyboard.type(" now");
    // At once, before autosave writes the input a second after the last key.
    const now = await onDisk();
    await fs.writeFile(file, now.replace(TEXT, `${TEXT}\n\nTheirs.`));
    const block = window.locator('[data-on-disk="Title"]');
    await expect(block).toContainText(TITLE);
    await expect(modeline(window)).toContainText("changed on disk");
    await expect(titleContent(window)).toHaveText(`${TITLE} now`);
    expect(await onDisk()).toContain(`title: ${TITLE}\n`);
    await resolve(window, "Keep my input");
    await expect(block).toHaveCount(0);
    await expect.poll(onDisk).toContain(`title: ${TITLE} now\n`);
    expect(await onDisk()).toContain("Theirs.");
  });

  test("[SR-105/AK2] after the title was saved, Ctrl/Cmd+Z brings the old title back and it is saved again", async () => {
    const { window } = running;
    await opened(window);
    await enterTitle(window);
    await window.keyboard.type(" now");
    await expect.poll(onDisk).toContain(`title: ${TITLE} now\n`);
    await window.keyboard.press("ControlOrMeta+Z");
    await expect(titleContent(window)).toHaveText(TITLE);
    await expect.poll(onDisk).toContain(`title: ${TITLE}\n`);
    expect(await cliTitle(running)).toBe(TITLE);
  });

  test("a click on the heading puts the caret where it was clicked, and a pasted paragraph becomes one line (#621)", async () => {
    const { window } = running;
    await opened(window);
    // The point of the 7th character of the heading's text ("Measure|").
    const point = await heading(window).evaluate((node) => {
      const range = document.createRange();
      const text = node.firstChild;
      if (text === null) {
        throw new Error("no text");
      }
      range.setStart(text, 7);
      range.setEnd(text, 7);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await window.mouse.click(point.x, point.y);
    await expect(titleContent(window)).toBeFocused();
    await window.keyboard.type("!");
    await expect(titleContent(window)).toHaveText("Measure! wind speed");
    // The clipboard of the machine the test runs on is put back afterwards.
    const kept = await running.app.evaluate(({ clipboard }) => clipboard.readText());
    try {
      await running.app.evaluate(({ clipboard }) => clipboard.writeText(" gusts\nand\n\nrain\n"));
      await window.keyboard.press("End");
      await window.keyboard.press("ControlOrMeta+V");
      await expect(titleContent(window)).toHaveText("Measure! wind speed gusts and rain");
    } finally {
      await running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), kept);
    }
    await expect.poll(onDisk).toContain("title: Measure! wind speed gusts and rain\n");
  });

  test("the heading and the text do not move when the title editor comes, for a one-line and a wrapping title (D-062, #542)", async () => {
    const { window } = running;
    // A second element, given a title that wraps, before it is opened.
    const long = `Show a dial ${"and the gusts over the whole field ".repeat(5).trim()}`;
    const result = await running.cli(["element", "update", "SR-0000b4", "--title", long]);
    expect(result.code).toBe(0);
    for (const [element, title] of [
      [ELEMENT, TITLE],
      ["SR-0000b4", long],
    ] as const) {
      await window.keyboard.press("ControlOrMeta+P");
      await window.keyboard.type(element);
      await expect(window.locator('.candidates [role="option"]').first()).toContainText(element);
      await window.keyboard.press("Enter");
      await expect(heading(window)).toHaveText(title);
      await expect(heading(window).locator(".cm-editor")).toHaveCount(0);
      const before = { heading: await box(heading(window)), text: await box(field(window, "Text")) };
      if (title === long) {
        // It wraps: more than one line of the heading.
        const lineHeight = await heading(window).evaluate((node) =>
          parseFloat(getComputedStyle(node).lineHeight),
        );
        expect(before.heading.height).toBeGreaterThan(1.5 * lineHeight);
      }
      await enterTitle(window);
      const after = { heading: await box(heading(window)), text: await box(field(window, "Text")) };
      for (const key of ["heading", "text"] as const) {
        expect(Math.abs(after[key].y - before[key].y)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(after[key].height - before[key].height)).toBeLessThanOrEqual(0.5);
      }
      await window.keyboard.press("Escape");
    }
  });
});
