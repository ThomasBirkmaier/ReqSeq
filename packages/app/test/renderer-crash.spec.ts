// The page of the window crashes while an element has input that cannot be saved (#270), on the built app:
// main loads the page again in the same window, without a dialog (SR-105 AK3), and the page shows the
// workspace and the element again with its input and the conflict still to be resolved.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };
const TITLE = "Measure wind speed";
const TEXT = "b1: derives from N1, in package P1.";
const FILE = path.join("requirements", "SR-0000000000b1.md");
const MINE = " Mine.";
const MORE = " More.";
const THEIRS = "Theirs.";
const CHANGED = `SR-0000b1 ${TITLE} changed on disk. Resolve with "Resolve change on disk"`;

const text = (window: Page): Locator => window.getByRole("textbox", { name: "Text" });

/** Opens the element and types at the end of its text. */
const typed = async (window: Page, input: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(TITLE);
  await expect(window.locator("article")).toBeFocused();
  await window.keyboard.press("Enter");
  await window.keyboard.type(input);
  await expect(window.getByLabel("Modeline")).toContainText("modified");
};

/** What the window shows after the crash, read in its page by the main process. */
interface Shown {
  readonly title?: string;
  readonly text?: string;
  readonly onDisk?: string;
  readonly modeline?: string;
  readonly minibuffer?: string;
}

/**
 * Reads what the window shows through the main process: Playwright gives up a page whose renderer
 * crashed (every call then fails with "Target crashed"), also after the window loaded it again.
 */
const shown = (running: RunningApp): Promise<Shown> =>
  running.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(`(() => {
      const text = (selector) => document.querySelector(selector)?.textContent ?? undefined;
      return {
        title: text("article h1"),
        text: text('[role="textbox"][aria-label="Text"]'),
        onDisk: text('[data-on-disk="Text"]'),
        modeline: text('[aria-label="Modeline"]'),
        minibuffer: text('[aria-label="Minibuffer"]'),
      };
    })()`),
  ) as Promise<Shown>;

/**
 * Ends the renderer of the window at once, as the system does when memory runs out. A kill, not
 * `forcefullyCrashRenderer()`: on the CI runners that crash hangs in Chromium's crash handling
 * ("Crashing because hung") and the process does not end in time.
 */
const crash = async (running: RunningApp): Promise<void> => {
  await running.app.evaluate(({ BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
    if (pid !== undefined) {
      process.kill(pid, "SIGKILL");
    }
  });
  await expect.poll(() => running.stderr(), { timeout: 30_000 }).toContain("The window's page ended (");
};

test.describe("a crash of the window's page", () => {
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

  test("loads the page again with the element and the input held back by a conflict", async () => {
    const before = running.window;
    await typed(before, MINE);
    // Another editor writes the file at once, before autosave: the input is held back (SR-106 AK2).
    const now = await onDisk();
    await fs.writeFile(file, now.replace(/\n---\n[\s\S]*$/, `\n---\n\n${TEXT}\n\n${THEIRS}\n`));
    await expect(before.locator('[data-on-disk="Text"]')).toContainText(THEIRS);
    await before.keyboard.type(MORE);
    await expect(text(before)).toHaveText(`${TEXT}${MINE}${MORE}`);
    // The input stays unsaved to the end: the window closes without asking, also if the test fails.
    running.discardAtClose();
    await crash(running);
    // The workspace, the element and its input are back, and the conflict is still to be resolved.
    await expect
      .poll(() => shown(running), { timeout: 10_000 })
      .toMatchObject({
        title: TITLE,
        text: `${TEXT}${MINE}${MORE}`,
        onDisk: expect.stringContaining(THEIRS),
        modeline: expect.stringContaining("changed on disk"),
        minibuffer: CHANGED,
      });
    // Nothing was saved over the file, and nothing is when the window closes.
    expect(await onDisk()).not.toContain(MINE);
  });
});
