// "Agent guide" and "Write skill file" (SR-229 AK1, AK16, AK18) on the built app: "Agent guide" runs at once and
// shows the guide whole, line by line as the command line gives it, not one line cut at the edge (#2141); "Write
// skill file" writes the skill file with one Enter, says where, and leaves a file it did not write. Keys use
// ControlOrMeta, so the tests run on Linux and macOS.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Where the skill file goes (D-079), relative to the root of the repository. */
const SKILL = ".claude/skills/managing-requirements/SKILL.md";

/** Chooses `title` in the command prompt with `key`. */
const choose = async (window: Page, title: string, key = "Enter"): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press(key);
};

test.describe("Agent guide and Write skill file", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-004/one-repository" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-229/AK-p4y6] the output page shows the guide whole, as the command line gives it", async () => {
    const { window } = running;
    await choose(window, "Agent guide");
    const cli = await running.cli(["tool", "guide"]);
    expect(cli.code).toBe(0);
    const expected = JSON.parse(cli.stdout) as { answer: string; guide: string };
    const page = window.locator(".result.output[data-buffer]");
    await expect(page.locator("h1.answer")).toHaveText(expected.answer);
    const block = page.locator(".line.block");
    await expect(block.locator(".label")).toHaveText("Agent guide");
    expect(await block.locator(".text").textContent()).toBe(expected.guide);
    await window.screenshot({ path: path.join(OUT, "agent-guide-light.png") });
  });

  test("[SR-229/AK-nsmz] Agent guide runs at once with the calls of the command line and writes nothing", async () => {
    const { window } = running;
    await choose(window, "Agent guide");
    const page = window.locator(".result.output[data-buffer]");
    await expect(page.locator("h1.answer")).toHaveText(
      "Gave the agent guide with commands named for the command line.",
    );
    await expect(window.locator("label.prompt-label")).toHaveCount(0);
    await expect(page.locator(".line.block .text")).toContainText("reqseq element create");
    const root = running.workspace?.root ?? "";
    await expect(readFile(path.join(root, SKILL), "utf8")).rejects.toThrow();
  });

  test("[SR-229/AK-y65m] Write skill file writes the skill file with one Enter, says where, and leaves a file it did not write", async () => {
    const { window } = running;
    const root = running.workspace?.root ?? "";
    await choose(window, "Write skill file");
    const page = window.locator(".result.output[data-buffer]");
    await expect(page.locator("h1.answer")).toHaveText(`Created the skill file ${SKILL}.`);
    const written = await readFile(path.join(root, SKILL), "utf8");
    expect(await page.locator(".line.block .text").textContent()).toBe(written);
    await window.screenshot({ path: path.join(OUT, "write-skill-file-light.png") });
    // Again, with Ctrl/Cmd+Enter: the same file, left as it is.
    await choose(window, "Write skill file", "ControlOrMeta+Enter");
    await expect(page.locator("h1.answer")).toHaveText(`Left the skill file ${SKILL} unchanged.`);
    // A file changed by hand is not replaced: no buffer opens, the shown one stays, the command line says why.
    await mkdir(path.dirname(path.join(root, SKILL)), { recursive: true });
    await writeFile(path.join(root, SKILL), "# My own skill\n");
    await choose(window, "Agent guide");
    await expect(page.locator("h1.answer")).toHaveText(
      "Gave the agent guide with commands named for the command line.",
    );
    await choose(window, "Write skill file");
    await expect(window.getByLabel("Minibuffer")).toContainText("Not written");
    await expect(page.locator("h1.answer")).toHaveText(
      "Gave the agent guide with commands named for the command line.",
    );
    expect(await readFile(path.join(root, SKILL), "utf8")).toBe("# My own skill\n");
  });
});
