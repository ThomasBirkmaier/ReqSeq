// Saving without a save command (SR-105) on the built app: the input of an element is in its file a second
// after the last key or at once when the element is left (AK1), undo and redo step through everything since
// the element was opened, also after it was saved and after another buffer was shown (AK2), and there is no
// button and no dialog to save (AK3). Every result is checked in the file of the workspace. Keys use
// ControlOrMeta (Linux and macOS). The screenshots of a save that failed (`not saved`) go to
// `test-results/electron/screenshots/` (or the folder in LOGREQ_SCREENSHOTS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { markdownMetamodel } from "./support/boxes.js";

const SR_FILE = "requirements/SR-0000000000c4.md";
const SR_TITLE = "Boxen bearbeiten";
const SR_ID = "69069069-0000-4000-8000-0000000000c4";
const TEXT = "Das Tool zeigt Messwerte an.";
/** A second element of the fixture, to leave the first one for. */
const OTHER_FILE = "requirements/SR-0000000000b1.md";
const OTHER_TITLE = "Measure wind speed";

const elementFile = `---
id: ${SR_ID}
type: system-requirement
status: draft
title: ${SR_TITLE}
requirement-type: performance
topic: Wind
---

${TEXT}
`;

const workspace = async () => ({
  fixture: "SR-069/filter",
  files: {
    "metamodel/standard-model.yaml": await markdownMetamodel(),
    [SR_FILE]: elementFile,
  },
});

const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const field = (window: Page, label: string): Locator => window.locator(`[data-field="${label}"]`);
const text = (window: Page): Locator => window.getByRole("textbox", { name: "Text" });
const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const minibuffer = (window: Page): Locator => window.getByLabel("Minibuffer");

/** Opens the element titled `title` with "Go to"; the buffer has the focus and its text editor is there. */
const open = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator("article")).toBeFocused();
  await expect(window.locator('article [data-field="Text"] .cm-content')).toBeVisible();
};

/** Runs the command `title` from the command prompt. */
const run = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
};

/** Waits until the file holds `part` (or no longer does), and gives how long that took after `since`. */
const written = async (
  read: () => Promise<string>,
  part: string,
  since: number,
  held = true,
): Promise<number> => {
  await expect.poll(async () => (await read()).includes(part), { intervals: [25], timeout: 5000 }).toBe(held);
  return Date.now() - since;
};

/** Reads a file of the workspace of `running`. */
const read = (running: RunningApp, file: string) => (): Promise<string> =>
  fs.readFile(path.join(running.workspace?.root ?? "", ...file.split("/")), "utf8");

test.describe("saving without a save command", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(await workspace());
    await open(running.window, SR_TITLE);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-105/AK1] a change is in the file a second after the last key, without a save command and without a message", async () => {
    const { window } = running;
    const before = await read(running, SR_FILE)();
    await window.keyboard.press("Enter");
    await window.keyboard.type("Neu.");
    const typed = Date.now();
    await expect(modeline(window)).toContainText("modified");
    // Not before the second has passed (typing more starts it again), and soon after it.
    expect(await read(running, SR_FILE)()).toBe(before);
    const took = await written(read(running, SR_FILE), `${TEXT}\nNeu.`, typed);
    expect(took).toBeGreaterThanOrEqual(800);
    expect(took).toBeLessThan(3000);
    test.info().annotations.push({ type: "autosave after the last key (ms)", description: String(took) });
    await expect(modeline(window)).not.toContainText("modified");
    await expect(minibuffer(window)).not.toContainText("Saved");
    // The CLI reads what the app wrote.
    const got = await running.cli(["element", "get", SR_ID]);
    expect(got.code).toBe(0);
    expect(got.stdout).toContain("Neu.");
  });

  test("[SR-105/AK1] leaving the element writes the change at once: another buffer, Go to, Close buffer and Close all buffers", async () => {
    const { window } = running;
    // Another buffer (Alt+N): the file has the input before the second would have passed.
    await window.keyboard.press("Enter");
    await window.keyboard.type("Eins.");
    let typed = Date.now();
    await window.keyboard.press("Alt+KeyN");
    expect(await written(read(running, SR_FILE), "Eins.", typed)).toBeLessThan(900);
    // Go to another element: the prompt that opens writes the input already.
    await window.keyboard.press("Alt+KeyP");
    await expect(window.locator("article h1")).toHaveText(SR_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Zwei.");
    typed = Date.now();
    await window.keyboard.press("ControlOrMeta+P");
    expect(await written(read(running, SR_FILE), "Zwei.", typed)).toBeLessThan(900);
    await window.keyboard.press("Escape");
    // Close buffer closes without asking: the input is written first.
    await window.locator("article").focus();
    await window.keyboard.press("Enter");
    await window.keyboard.type("Drei.");
    await run(window, "Close buffer");
    await expect(window.locator("article h1")).toHaveCount(0);
    expect(await read(running, SR_FILE)()).toContain("Drei.");
    // Close all buffers, with input in two elements: nothing is asked, both files have it.
    await open(window, SR_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Vier.");
    await open(window, OTHER_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Fünf.");
    await run(window, "Close all buffers");
    await expect(minibuffer(window)).not.toContainText("unsaved");
    await expect(window.locator("article h1")).toHaveCount(0);
    expect(await read(running, SR_FILE)()).toContain("Vier.");
    expect(await read(running, OTHER_FILE)()).toContain("Fünf.");
  });

  test("[SR-105/AK2] undo and redo of the text step through its states since opening, also after it was saved and after another buffer was shown", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await window.keyboard.type("Neu.");
    await written(read(running, SR_FILE), "Neu.", Date.now());
    await expect(modeline(window)).not.toContainText("modified");
    // Saved, and still undone with the key; the undone state is saved like any input.
    await window.keyboard.press("ControlOrMeta+Z");
    await expect(text(window)).not.toContainText("Neu.");
    await written(read(running, SR_FILE), "Neu.", Date.now(), false);
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await expect(text(window)).toContainText("Neu.");
    await written(read(running, SR_FILE), "Neu.", Date.now());
    // Another buffer and back: the history is still there.
    await window.keyboard.press("Alt+KeyN");
    await expect(window.locator("article h1")).toHaveCount(0);
    await window.keyboard.press("Alt+KeyP");
    await expect(window.locator("article h1")).toHaveText(SR_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Z");
    await expect(text(window)).toHaveText(TEXT);
    await written(read(running, SR_FILE), "Neu.", Date.now(), false);
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await expect(text(window)).toContainText("Neu.");
  });

  test("[SR-105/AK2] undo and redo of a text box and of a choice after they were saved", async () => {
    const { window } = running;
    // A text box.
    await field(window, "topic").locator(".cm-line").click();
    await window.keyboard.press("End");
    await window.keyboard.type(" und Böen");
    await written(read(running, SR_FILE), "topic: Wind und Böen", Date.now());
    await window.keyboard.press("ControlOrMeta+Z");
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("Wind");
    await written(read(running, SR_FILE), "topic: Wind und Böen", Date.now(), false);
    expect(await read(running, SR_FILE)()).toContain("topic: Wind\n");
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("Wind und Böen");
    // A choice, set in the prompt.
    await field(window, "requirement-type").focus();
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.type("qual");
    await window.keyboard.press("Enter");
    await expect(field(window, "requirement-type")).toBeFocused();
    await written(read(running, SR_FILE), "requirement-type: quality", Date.now());
    await window.keyboard.press("ControlOrMeta+Z");
    await expect(field(window, "requirement-type")).toContainText("performance");
    await written(read(running, SR_FILE), "requirement-type: performance", Date.now());
    // After another buffer was shown, the step forth is still there.
    await window.keyboard.press("Alt+KeyN");
    await window.keyboard.press("Alt+KeyP");
    await expect(window.locator("article h1")).toHaveText(SR_TITLE);
    await field(window, "requirement-type").focus();
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await expect(field(window, "requirement-type")).toContainText("quality");
    await written(read(running, SR_FILE), "requirement-type: quality", Date.now());
  });

  test("[SR-105/AK1] quitting the app within a second of the last key writes the change before the window closes", async () => {
    const { app, window } = running;
    await window.keyboard.press("Enter");
    await window.keyboard.type(" Beim Beenden.");
    await expect(modeline(window)).toContainText("modified");
    const exited = app.waitForEvent("close");
    // As Cmd+Q or File > Quit do: the app quits, which closes the window first.
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await exited;
    expect(await read(running, SR_FILE)()).toContain("Beim Beenden.");
  });

  test("[SR-105/AK1] quitting the app with nothing typed ends it within a few seconds, and writes nothing (#611 review S2)", async () => {
    const { app } = running;
    const before = await read(running, SR_FILE)();
    const exited = app.waitForEvent("close", { timeout: 5000 });
    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });
    await exited;
    expect(await read(running, SR_FILE)()).toBe(before);
  });

  test("[SR-105/AK1] closing the window with input that cannot be saved keeps it open once and says why; closing again discards it", async () => {
    const { app, window } = running;
    const file = read(running, SR_FILE);
    await window.keyboard.press("Enter");
    await window.keyboard.type(" Meins.");
    // Another editor changes the file before the autosave: the input is not saved over it (SR-106 AK2).
    const theirs = elementFile.replace(TEXT, "Fremd geändert.");
    await fs.writeFile(path.join(running.workspace?.root ?? "", ...SR_FILE.split("/")), theirs);
    await expect(modeline(window)).toContainText("changed on disk");
    const closeWindow = (): Promise<void> =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      });
    await closeWindow();
    await expect(minibuffer(window)).toHaveText(
      /could not be saved \(.*\): close the window again to discard the unsaved input$/,
    );
    await expect(window.locator('[role="dialog"], [role="alertdialog"], dialog')).toHaveCount(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    const exited = app.waitForEvent("close");
    await closeWindow();
    await exited;
    const after = await file();
    expect(after).toContain("Fremd geändert.");
    expect(after).not.toContain("Meins.");
  });

  test("[SR-105/AK3] there is no button and no dialog to save, when typing, leaving or closing", async () => {
    const { app, window } = running;
    // Electron's own dialogs: none to save, and no message box (counted in the main process).
    await app.evaluate(({ dialog }) => {
      const calls: string[] = [];
      (globalThis as { savingDialogs?: string[] }).savingDialogs = calls;
      for (const name of [
        "showSaveDialog",
        "showSaveDialogSync",
        "showMessageBox",
        "showMessageBoxSync",
      ] as const) {
        // A call is what the test looks for; no dialog is shown for it.
        (dialog as unknown as Record<string, unknown>)[name] = () => {
          calls.push(name);
        };
      }
    });
    const noSaving = async (): Promise<void> => {
      await expect(window.getByRole("button", { name: /save/i })).toHaveCount(0);
      await expect(window.locator('[role="dialog"], [role="alertdialog"], dialog')).toHaveCount(0);
      expect(
        await window.locator("button").evaluateAll((buttons) => buttons.map((b) => b.textContent)),
      ).not.toContainEqual(expect.stringMatching(/save/i));
    };
    await window.keyboard.press("Enter");
    await window.keyboard.type("Neu.");
    await noSaving();
    await window.keyboard.press("Alt+KeyN");
    await noSaving();
    await window.keyboard.press("Alt+KeyP");
    await expect(window.locator("article h1")).toHaveText(SR_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Mehr.");
    await run(window, "Close buffer");
    await expect(window.locator("article h1")).toHaveCount(0);
    await noSaving();
    expect(await read(running, SR_FILE)()).toContain("Mehr.");
    expect(await app.evaluate(() => (globalThis as { savingDialogs?: string[] }).savingDialogs)).toEqual([]);
    // The command prompt offers no other command to save than "Save element" (Ctrl/Cmd+S, a key, not a
    // button or a dialog).
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("save");
    const names = await window.locator('.candidates [role="option"] .name').allInnerTexts();
    expect(names.filter((name) => /\bsave\b/i.test(name) && name !== "Save element")).toEqual([]);
    await window.keyboard.press("Escape");
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`screenshot of a save that failed in ${scheme}`, async () => {
    const running = await launchApp(await workspace(), { colorScheme: scheme });
    const { window } = running;
    // The folder of the element cannot be written: core refuses the save, and the input stays.
    const folder = path.join(running.workspace?.root ?? "", path.dirname(SR_FILE));
    try {
      await fs.mkdir(OUT, { recursive: true });
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      await open(window, SR_TITLE);
      await fs.chmod(folder, 0o555);
      await window.keyboard.press("Enter");
      await window.keyboard.type(" Neu.");
      await expect(modeline(window)).toContainText("not saved", { timeout: 5000 });
      await expect(modeline(window)).toContainText("modified");
      await expect(text(window)).toContainText("Neu.");
      await window.screenshot({ path: path.join(OUT, `sr-105-not-saved-${scheme}.png`) });
      // Writable again: the next input saves, and `not saved` goes.
      await fs.chmod(folder, 0o755);
      await window.keyboard.type(" Mehr.");
      await written(read(running, SR_FILE), "Neu. Mehr.", Date.now());
      await expect(modeline(window)).not.toContainText("not saved");
    } finally {
      await fs.chmod(folder, 0o755);
      await running.close();
    }
  });
}
