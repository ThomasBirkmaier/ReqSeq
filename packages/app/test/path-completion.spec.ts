// Path completion in the command prompt on the built app (SR-143): "Open workspace" completes a typed
// folder path with the folders of its folder, in place of the recent workspaces (AK1); a path argument of
// another command completes relative from the workspace root and absolute, with files, and `~` is the home
// folder there as when the command runs (AK2); folders come before files with the matched letters marked
// (AK3); a missing or unreadable folder is named and the typed path still taken (AK4); 10,000 entries
// update within 100 ms (AK5); names with a leading "." only for a typed ".". The home folder is the
// temporary one `launchApp` gives the app (HOME and USERPROFILE). Keys use ControlOrMeta.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const STATION = { fixture: "SR-069/filter", name: "kestrel" };
const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const label = (window: Page) => window.locator("label.prompt-label");
const input = (window: Page) => window.locator("#prompt-input");

/** Runs a command of the prompt by its title and waits for its first prompt. */
const runCommand = async (window: Page, title: string, asks: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(names(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText(asks);
};

const openWorkspacePrompt = (window: Page): Promise<void> =>
  runCommand(window, "Open workspace", "Workspace");
const exportPrompt = (window: Page): Promise<void> =>
  runCommand(window, "Export ReqIF", "Export ReqIF · output:");

/** Makes folders (a name ending in "/") and empty files below `root`. */
const make = async (root: string, ...entries: string[]): Promise<void> => {
  for (const entry of entries) {
    if (entry.endsWith("/")) {
      await fs.mkdir(path.join(root, entry), { recursive: true });
    } else {
      await fs.mkdir(path.dirname(path.join(root, entry)), { recursive: true });
      await fs.writeFile(path.join(root, entry), "");
    }
  }
};

const sep = path.sep;

/** Runs `job` for 0..count-1, 500 at a time, so Windows does not run out of file handles (EMFILE). */
const inBatches = async (count: number, job: (i: number) => Promise<unknown>): Promise<void> => {
  for (let start = 0; start < count; start += 500) {
    await Promise.all(Array.from({ length: Math.min(500, count - start) }, (_, i) => job(start + i)));
  }
};

test.describe("Path completion", () => {
  let running: RunningApp;
  let home: string;
  let dir: string;

  test.beforeEach(async () => {
    running = await launchApp(STATION);
    // The home folder the app's processes take for `~` (USERPROFILE on Windows, HOME elsewhere), not
    // Electron's app.getPath("home"), which on Windows asks the shell for the real profile folder.
    home = running.kept.home;
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-paths-")));
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
    await fs.chmod(path.join(dir, "locked"), 0o755).catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('[SR-143/AK1] "Open workspace" offers the folders of the folder typed last, and a choice completes the path without opening it', async () => {
    const { window } = running;
    await make(home, "projects/", "prose/", "zebra/", "proposal.txt");
    await openWorkspacePrompt(window);
    await window.keyboard.type("~/pro");
    // In place of the recent workspaces: the typed path first, then the folders in ~ that match "pro".
    await expect(names(window)).toHaveText(["Open ~/pro", "projects/", "prose/"]);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(input(window)).toHaveValue("~/projects/");
    await expect(label(window)).toHaveText("Workspace");
    await expect(window).toHaveTitle("Weather station - ReqSeq");
    // Typing goes on in it.
    await window.keyboard.type("x");
    await expect(input(window)).toHaveValue("~/projects/x");
    await expect(names(window).first()).toHaveText("Open ~/projects/x");
  });

  test("[SR-143/AK2] a file argument completes relative from the workspace root and absolute, with files, and ~ is the home folder", async () => {
    const { window } = running;
    const root = running.workspace?.root ?? "";
    await make(home, "notes.txt", "drafts/");
    await make(dir, "spec.reqif", "older/");
    await exportPrompt(window);
    // Relative: from the workspace root.
    await window.keyboard.type("reqseq-w");
    await expect(names(window)).toHaveText(["Use reqseq-w", "reqseq-workspace.yaml"]);
    expect(root).not.toBe("");
    // Absolute, with folders and files.
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.insertText(`${dir}${sep}`);
    await expect(names(window)).toHaveText([`Use ${dir}${sep}`, `older${sep}`, "spec.reqif"]);
    // `~` is the home folder, in the completion and when the command writes.
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.type("~/");
    // The home folder also holds the app's own folders of this test (user data, caches).
    await expect(names(window).first()).toHaveText("Use ~/");
    await expect(names(window).filter({ hasText: /^(?:drafts\/|notes\.txt)$/ })).toHaveText([
      "drafts/",
      "notes.txt",
    ]);
    await expect(names(window).last()).toHaveText("notes.txt");
    await window.keyboard.type("out.reqif");
    await expect(names(window).first()).toHaveText("Use ~/out.reqif");
    await window.keyboard.press("Enter");
    await expect
      .poll(() =>
        fs.stat(path.join(home, "out.reqif")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(fs.stat(path.join(root, "~"))).rejects.toThrow();
  });

  test("[SR-143/AK3] folders come before files, and the matched letters are marked as for commands", async () => {
    const { window } = running;
    await make(dir, "alpha.reqif", "salad/", "palace/");
    await exportPrompt(window);
    await window.keyboard.insertText(`${dir}${sep}al`);
    await expect(names(window)).toHaveText([
      `Use ${dir}${sep}al`,
      `palace${sep}`,
      `salad${sep}`,
      // The best match, a file: still after the folders.
      "alpha.reqif",
    ]);
    const option = window.locator('.candidates [role="option"]');
    for (const at of [1, 2, 3]) {
      await expect(option.nth(at).locator("mark")).toHaveText(["al"]);
    }
    await window.screenshot({ path: path.join(SHOTS, "path-completion-light.png") });
  });

  test("[SR-143/AK4] a missing folder gives no entries, says it is missing, and the typed path is still taken", async () => {
    const { window } = running;
    await openWorkspacePrompt(window);
    const gone = path.join(dir, "gone");
    await window.keyboard.insertText(`${gone}${sep}x`);
    await expect(label(window)).toHaveText(`${gone} is missing · Workspace`);
    await expect(names(window)).toHaveText([`Open ${gone}${sep}x`]);
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer")).toHaveText(
      `No workspace in ${gone}${sep}x or a folder above it; Weather station stays open`,
    );
  });

  test("[SR-143/AK4] an unreadable folder gives no entries, says it is not readable, and the typed path is still taken", async () => {
    // Windows has no mode bits that deny reading a folder: chmod changes only the read-only flag there.
    test.skip(process.platform === "win32", "chmod does not make a folder unreadable on Windows");
    const { window } = running;
    await make(dir, "locked/inner/");
    await fs.chmod(path.join(dir, "locked"), 0o000);
    await exportPrompt(window);
    const locked = path.join(dir, "locked");
    await window.keyboard.insertText(`${locked}${sep}in`);
    await expect(label(window)).toHaveText(`${locked} is not readable · Export ReqIF · output:`);
    await expect(names(window)).toHaveText([`Use ${locked}${sep}in`]);
    await window.keyboard.press("Enter");
    // The command took it: the prompt for the output is gone.
    await expect(window.getByText(`${locked} is not readable · Export ReqIF · output:`)).toHaveCount(0);
  });

  test("[SR-143/AK5] in a folder of 10,000 entries the suggestions are updated within 100 ms of a key", async () => {
    const { window } = running;
    const big = path.join(dir, "big");
    await fs.mkdir(big);
    for (let i = 0; i < 1000; i += 1) {
      await fs.mkdir(path.join(big, `d${String(i).padStart(5, "0")}`));
    }
    await inBatches(9000, (i) => fs.writeFile(path.join(big, `f${String(i).padStart(5, "0")}.txt`), ""));
    // For "Open workspace", which lists folders only (through main): 10,000 folders.
    const wide = path.join(dir, "wide");
    await fs.mkdir(wide);
    await inBatches(10_000, (i) =>
      fs.mkdir(path.join(wide, `${i < 5000 ? "a" : "b"}${String(i % 5000).padStart(5, "0")}`)),
    );
    await exportPrompt(window);
    // Warm up: the parent folder, listed and narrowed once.
    await window.keyboard.insertText(`${dir}${sep}b`);
    await expect(names(window).nth(1)).toHaveText(`big${sep}`);
    await window.keyboard.press("Backspace");
    await window.keyboard.type("big");
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
    // A separator: the folder is listed afresh.
    const listed = await timed(sep === "\\" ? "Backslash" : "Slash", `d00000${sep}`);
    // A letter: the listing is narrowed.
    const narrowed = await timed("f", "f00000.txt");
    await expect(names(window).last()).toHaveText(/^… [\d,]+ more$/);
    // "Open workspace": the same through main.
    await window.keyboard.press("Escape");
    await openWorkspacePrompt(window);
    await window.keyboard.insertText(`${dir}${sep}w`);
    await expect(names(window).nth(1)).toHaveText(`wide${sep}`);
    await window.keyboard.press("Backspace");
    await window.keyboard.type("wide");
    const opened = await timed(sep === "\\" ? "Backslash" : "Slash", `a00000${sep}`);
    const chosen = await timed("b", `b00000${sep}`);
    // The times in the report, to see the margin on each system.
    test.info().annotations.push({
      type: "timing",
      description: `Export ReqIF: separator ${listed.toFixed(1)} ms, letter ${narrowed.toFixed(1)} ms; Open workspace: separator ${opened.toFixed(1)} ms, letter ${chosen.toFixed(1)} ms`,
    });
    expect(listed).toBeLessThanOrEqual(100);
    expect(narrowed).toBeLessThanOrEqual(100);
    expect(opened).toBeLessThanOrEqual(100);
    expect(chosen).toBeLessThanOrEqual(100);
  });

  test('[SR-143/AK6] names that start with "." are offered only when the typed name starts with "."', async () => {
    const { window } = running;
    await make(dir, ".hidden/", ".env", "visible/", "plain.txt");
    await exportPrompt(window);
    await window.keyboard.insertText(`${dir}${sep}`);
    await expect(names(window)).toHaveText([`Use ${dir}${sep}`, `visible${sep}`, "plain.txt"]);
    await window.keyboard.type(".");
    await expect(names(window)).toHaveText([`Use ${dir}${sep}.`, `.hidden${sep}`, ".env"]);
  });
});
