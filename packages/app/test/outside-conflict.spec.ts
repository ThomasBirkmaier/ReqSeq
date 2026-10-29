// An open element whose file changes outside the app while it has input, or is deleted (SR-106 AK2, AK3,
// SR-116 AK3), on the built app: the CLI, an agent through MCP or the file system changes the file. Nothing
// is saved over the file, the input stays, a block "On disk" shows the file's version, and "Resolve change
// on disk" lets the user choose; a deleted file leaves the content read-only with a hint. The screenshots
// of the block go to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };
/** SR-0000b1 "Measure wind speed" and the text of its file. */
const ELEMENT = "SR-0000b1";
const TITLE = "Measure wind speed";
const NAME = `${ELEMENT} ${TITLE}`;
const TEXT = "b1: derives from N1, in package P1.";
const FILE = path.join("requirements", "SR-0000000000b1.md");
const MINE = " Mine.";
const THEIRS = "Theirs.";
const CHANGED = `${NAME} changed on disk. Resolve with "Resolve change on disk"`;

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** The editor of the text (the property boxes have editors of their own). */
const text = (window: Page): Locator => window.getByRole("textbox", { name: "Text" });

const opened = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(TITLE);
  await expect(text(window)).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

/** Opens the element and types at the end of its text: unsaved input. */
const typed = async (window: Page): Promise<void> => {
  await opened(window);
  await window.keyboard.press("Enter");
  await window.keyboard.type(MINE);
  await expect(window.getByLabel("Modeline")).toContainText("modified");
};

/**
 * Changes the file outside the app at once, as another editor does: the text, and the title when given.
 * At once, because autosave writes the input a second after the last key (SR-105 AK1); a CLI that takes
 * longer to start would find the input saved already. Written before that save, the file always has other
 * bytes than the input was typed on, so core refuses the save and the conflict rule applies.
 */
const changeOutside = async (file: string, change: { readonly text: string; readonly title?: string }) => {
  const now = await fs.readFile(file, "utf8");
  const body = now.replace(/\n---\n[\s\S]*$/, `\n---\n\n${change.text}\n`);
  await fs.writeFile(
    file,
    change.title === undefined ? body : body.replace(`title: ${TITLE}`, `title: ${change.title}`),
  );
};

/** "Resolve change on disk" from the command prompt, and the choice `name`. */
const resolve = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Resolve change on disk");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Resolve change on disk");
  await window.keyboard.press("Enter");
  await expect(window.locator('.candidates [role="option"]')).toHaveText(["Keep my input", "Take the file"]);
  await window.keyboard.type(name);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(name);
  await window.keyboard.press("Enter");
};

test.describe("an open element changed or deleted outside the app", () => {
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

  test('[SR-106/AK2] with unsaved input an outside change is not saved over: both versions are shown, and "Keep my input" writes only the input', async () => {
    const { window } = running;
    await typed(window);
    // A person changes the title and the text in another editor.
    await changeOutside(file, { title: "Measure the wind", text: `${TEXT}\n\n${THEIRS}` });
    const block = window.locator('[data-on-disk="Text"]');
    await expect(block).toContainText(THEIRS);
    await expect(text(window)).toHaveText(`${TEXT}${MINE}`);
    await expect(window.getByLabel("Modeline")).toContainText("changed on disk");
    await expect(window.getByLabel("Minibuffer")).toHaveText(CHANGED);
    // Saving is refused until the user chooses.
    await window.keyboard.press("ControlOrMeta+S");
    await expect(window.getByLabel("Minibuffer")).toHaveText("Resolve the change on disk first");
    const theirs = await onDisk();
    expect(theirs).toContain(THEIRS);
    expect(theirs).not.toContain(MINE);
    await resolve(window, "Keep my input");
    await expect(window.getByLabel("Minibuffer")).toHaveText(`Saved ${NAME}`);
    await expect(block).toHaveCount(0);
    await expect(window.getByLabel("Modeline")).not.toContainText("on disk");
    // The input is written; the change of the title, a field without input, stays.
    const kept = await onDisk();
    expect(kept).toContain(`${TEXT}\n${MINE}`);
    expect(kept).not.toContain(THEIRS);
    expect(kept).toContain("title: Measure the wind");
  });

  test('[SR-106/AK2] "Take the file" leaves the file as it is, and Ctrl+Z brings the input back', async () => {
    const { window } = running;
    await typed(window);
    await changeOutside(file, { text: `${TEXT}\n\n${THEIRS}` });
    await expect(window.locator('[data-on-disk="Text"]')).toContainText(THEIRS);
    const theirs = await onDisk();
    // Enter on the block asks too.
    await window.locator('[data-on-disk="Text"]').focus();
    await window.keyboard.press("Enter");
    await expect(window.locator('.candidates [role="option"]')).toHaveText([
      "Keep my input",
      "Take the file",
    ]);
    await window.keyboard.press("Escape");
    await resolve(window, "Take the file");
    await expect(text(window)).toContainText(THEIRS);
    await expect(text(window)).not.toContainText(MINE.trim());
    await expect(window.locator("[data-on-disk]")).toHaveCount(0);
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
    expect(await onDisk()).toBe(theirs);
    // The input is not lost: one undo in the text brings it back.
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Z");
    await expect(text(window)).toHaveText(`${TEXT}${MINE}`);
    // The undo is input on the file the user took, so autosave writes it a second later (SR-105 AK2).
    await expect.poll(onDisk, { timeout: 5000 }).toContain(MINE);
    expect(await onDisk()).not.toContain(THEIRS);
  });

  test("[SR-106/AK3] a deleted file leaves the content in the editor and a hint names the deletion", async () => {
    const { window } = running;
    await typed(window);
    await fs.rm(file);
    await expect(window.getByLabel("Modeline")).toContainText("deleted on disk");
    const deleted = `${NAME} was deleted on disk; its content stays here until you close the buffer`;
    await expect(window.getByLabel("Minibuffer")).toHaveText(deleted);
    await expect(text(window)).toHaveText(`${TEXT}${MINE}`);
    await expect(text(window)).toHaveAttribute("contenteditable", "false");
    // Nothing is written, and the file is not made again.
    await window.keyboard.press("ControlOrMeta+S");
    await expect(window.getByLabel("Minibuffer")).toHaveText(deleted);
    // Longer than a batch of the watcher takes (at most 1 s).
    await window.waitForTimeout(1500);
    await expect(fs.access(file)).rejects.toThrow();
    await expect(text(window)).toHaveText(`${TEXT}${MINE}`);
    // The input of a deleted file cannot be saved: the window would ask once before it closes.
    running.discardAtClose();
  });

  test("[SR-116/AK3] with unsaved changes an outside change through MCP follows the conflict rule and no input is lost", async () => {
    const { window } = running;
    const mcp = await running.mcp();
    // The agent has its workspace loaded, so its change comes before autosave writes the input.
    await mcp.call("element_get", { ref: ELEMENT });
    await typed(window);
    await mcp.call("element_update", { ref: ELEMENT, text: `${TEXT}\n\nMeasured by the agent.` });
    await expect(window.locator('[data-on-disk="Text"]')).toContainText("Measured by the agent.");
    await expect(text(window)).toHaveText(`${TEXT}${MINE}`);
    await expect(window.getByLabel("Minibuffer")).toHaveText(CHANGED);
    // The field with input is not highlighted: the block speaks there.
    await expect(window.locator('[data-field="Text"]')).not.toHaveClass(/outside-change/);
    await window.keyboard.press("ControlOrMeta+S");
    await expect(window.getByLabel("Minibuffer")).toHaveText("Resolve the change on disk first");
    const agent = await onDisk();
    expect(agent).toContain("Measured by the agent.");
    expect(agent).not.toContain(MINE);
    // The conflict is not resolved: the window would ask once before it closes.
    running.discardAtClose();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`screenshot of a change on disk under the input in ${scheme}`, async () => {
    const running = await launchApp(FIXTURE, { colorScheme: scheme });
    const { window } = running;
    try {
      await fs.mkdir(OUT, { recursive: true });
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      await listAll(window);
      await typed(window);
      await changeOutside(path.join(running.workspace?.root ?? "", FILE), { text: `${TEXT}\n\n${THEIRS}` });
      await expect(window.locator('[data-on-disk="Text"]')).toContainText(THEIRS);
      await window.locator('[data-on-disk="Text"]').focus();
      await window.screenshot({ path: path.join(OUT, `sr-106-c-${scheme}.png`) });
    } finally {
      // The conflict is not resolved: the window would ask once before it closes.
      await running.close({ discard: true });
    }
  });
}
