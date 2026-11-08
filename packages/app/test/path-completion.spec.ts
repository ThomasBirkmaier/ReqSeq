// Path completion in the command prompt on the built app (SR-143): "Open workspace" completes a typed
// folder path with the folders of its folder, in place of the recent workspaces (AK1); a path argument of
// another command completes relative from the workspace root and absolute, with files, and `~` is the home
// folder there as when the command runs (AK2); folders come before files with the matched letters marked
// (AK3); a missing or unreadable folder is named and the typed path still taken (AK4); 10,000 entries
// are listed and narrowed (their 100 ms of AK5 are asserted in the performance suite, perf/path-completion.spec.ts,
// ADR-0011, #1128); names with a leading "." only for a typed ".". The home folder is the
// temporary one `launchApp` gives the app (HOME and USERPROFILE). Keys use ControlOrMeta.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import {
  exportPrompt,
  input,
  label,
  makeTenThousand,
  names,
  openWorkspacePrompt,
  sep,
  typeThroughTenThousand,
} from "./support/path-prompt.js";

const STATION = { fixture: "SR-069/filter", name: "kestrel" };
const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

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

  // SR-143 AK5 without its time: the 100 ms are asserted in the performance suite, on the runner of the reference
  // machine (ADR-0011), because a macOS or Windows runner is slower at times (#1128). The times are reported here.
  test("in a folder of 10,000 entries the suggestions are listed and narrowed key by key", async () => {
    const { window } = running;
    await makeTenThousand(dir);
    const times = await typeThroughTenThousand(window, dir);
    test.info().annotations.push({
      type: "timing",
      description: `Export ReqIF: separator ${times.listed.toFixed(1)} ms, letter ${times.narrowed.toFixed(1)} ms; Open workspace: separator ${times.opened.toFixed(1)} ms, letter ${times.chosen.toFixed(1)} ms`,
    });
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
