// The command prompt with a path argument (SR-143), shared by the Electron suite (path-completion.spec.ts) and the
// app's part of the performance suite (perf/path-completion.spec.ts).
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

export const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
export const label = (window: Page): Locator => window.locator("label.prompt-label");
export const input = (window: Page): Locator => window.locator("#prompt-input");

export const sep = path.sep;

/** Runs a command of the prompt by its title and waits for its first prompt. */
export const runCommand = async (window: Page, title: string, asks: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(names(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText(asks);
};

export const openWorkspacePrompt = (window: Page): Promise<void> =>
  runCommand(window, "Open workspace", "Workspace");
export const exportPrompt = (window: Page): Promise<void> =>
  runCommand(window, "Export ReqIF", "Export ReqIF · output:");

/**
 * A person types the separator after a folder's name some time after its last letter: the name's row is
 * shown, and half a second passes, in which the prompt asks ahead for that folder's listing.
 */
export const typingPause = async (window: Page, row: string): Promise<void> => {
  await expect(names(window).nth(1)).toHaveText(row);
  await window.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
};

/** Runs `job` for 0..count-1, 500 at a time, so Windows does not run out of file handles (EMFILE). */
export const inBatches = async (count: number, job: (i: number) => Promise<unknown>): Promise<void> => {
  for (let start = 0; start < count; start += 500) {
    await Promise.all(Array.from({ length: Math.min(500, count - start) }, (_, i) => job(start + i)));
  }
};

/**
 * Makes the folders of SR-143 AK5 in `dir`: `big` with 1,000 folders and 9,000 files (for a path argument), and
 * `wide` with 10,000 folders (for "Open workspace", which lists folders only, through main).
 */
export const makeTenThousand = async (
  dir: string,
): Promise<{ readonly big: string; readonly wide: string }> => {
  const big = path.join(dir, "big");
  await fs.mkdir(big);
  for (let i = 0; i < 1000; i += 1) {
    await fs.mkdir(path.join(big, `d${String(i).padStart(5, "0")}`));
  }
  await inBatches(9000, (i) => fs.writeFile(path.join(big, `f${String(i).padStart(5, "0")}.txt`), ""));
  const wide = path.join(dir, "wide");
  await fs.mkdir(wide);
  await inBatches(10_000, (i) =>
    fs.mkdir(path.join(wide, `${i < 5000 ? "a" : "b"}${String(i % 5000).padStart(5, "0")}`)),
  );
  return { big, wide };
};

/** The times of SR-143 AK5 in ms, from the key to the second row (the first entry) showing what it should. */
export interface TenThousandTimes {
  /** "Export ReqIF": the separator after the pause shows the folder's listing asked ahead. */
  readonly listed: number;
  /** "Export ReqIF": a letter narrows the listing. */
  readonly narrowed: number;
  /** "Open workspace": the separator, through main. */
  readonly opened: number;
  /** "Open workspace": a letter, through main. */
  readonly chosen: number;
}

/**
 * Types through the folders of `makeTenThousand` in `dir`, in "Export ReqIF" and then "Open workspace", checks
 * that each key shows the listing it should, and gives the time each took in the page.
 */
export const typeThroughTenThousand = async (window: Page, dir: string): Promise<TenThousandTimes> => {
  /** The time from the key to the second row (the first entry) showing `expected`, in the page. */
  const timed = async (key: string, expected: string): Promise<number> => {
    await window.evaluate((wanted) => {
      const state = window as unknown as { pressed: number | undefined; took: number | undefined };
      state.pressed = undefined;
      state.took = undefined;
      document.addEventListener(
        "keydown",
        () => {
          state.pressed = performance.now();
        },
        { capture: true, once: true },
      );
      const observer = new MutationObserver(() => {
        const row = document.querySelectorAll('.candidates [role="option"] .name')[1];
        if (state.pressed !== undefined && row?.textContent === wanted) {
          state.took = performance.now() - state.pressed;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, expected);
    await window.keyboard.press(key);
    await expect(names(window).nth(1)).toHaveText(expected);
    return window.evaluate(() => (window as unknown as { took?: number }).took ?? Infinity);
  };
  const separator = sep === "\\" ? "Backslash" : "Slash";
  await exportPrompt(window);
  // Warm up: the parent folder, listed and narrowed once.
  await window.keyboard.insertText(`${dir}${sep}b`);
  await expect(names(window).nth(1)).toHaveText(`big${sep}`);
  await window.keyboard.press("Backspace");
  await window.keyboard.type("big");
  await typingPause(window, `big${sep}`);
  const listed = await timed(separator, `d00000${sep}`);
  const narrowed = await timed("f", "f00000.txt");
  await expect(names(window).last()).toHaveText(/^… [\d,]+ more$/);
  await window.keyboard.press("Escape");
  await openWorkspacePrompt(window);
  await window.keyboard.insertText(`${dir}${sep}w`);
  await expect(names(window).nth(1)).toHaveText(`wide${sep}`);
  await window.keyboard.press("Backspace");
  await window.keyboard.type("wide");
  await typingPause(window, `wide${sep}`);
  const opened = await timed(separator, `a00000${sep}`);
  const chosen = await timed("b", `b00000${sep}`);
  return { listed, narrowed, opened, chosen };
};
