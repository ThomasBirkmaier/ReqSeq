// The difference of a variant to the core on the built app (SR-044 AK2) on fixtures/SR-044/side-by-side:
// core requirements K1 (SR-0000a1) and K2 (SR-0000a2); variant A „Coast“ (VAR-0000c1) replaces K1 by A1
// (SR-0000b1), excludes K2 and adds A2 (SR-0000b2). K1 and A1 have a text and an acceptance criterion.
// "Show variant difference" in the command prompt runs `variant.diff` into the result buffer; Enter on the
// replaced row shows K1 and A1 side by side, read-only. Keys use ControlOrMeta, so the same test runs on
// Linux and macOS.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const TITLE = "Show variant difference";
const K1 = "Response time at most 10 ms";
const A1 = "Response time at most 20 ms";

test.describe("the difference of a variant in the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-044/side-by-side" });
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** The bytes of a requirement file of the workspace copy. */
  const file = (name: string): Promise<string> =>
    readFile(path.join(running.workspace?.root ?? "", "requirements", name), "utf8");

  /** The area shows `title` read-only: its text and its acceptance criterion, and no editor takes input. */
  const shownReadOnly = async (area: Locator, title: string, text: string, criterion: string) => {
    await expect(area.locator("article h1")).toHaveText(title);
    await expect(area.locator("article")).toContainText(text);
    await expect(area.locator("article")).toContainText(criterion);
    for (const editor of await area.locator(".cm-content").all()) {
      await expect(editor).toHaveAttribute("contenteditable", "false");
    }
  };

  test("[SR-044/AK2] Enter on a replaced row shows K1 and A1 read-only side by side in the split window", async () => {
    const { window } = running;
    const names = window.locator('.candidates [role="option"] .name');
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type(TITLE);
    await expect(names.first()).toHaveText(TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Coast");
    await expect(names.first()).toHaveText("VAR-0000c1 Coast");
    await window.keyboard.press("Enter");
    // The three lists, as the CLI gives them (SR-044 AK1, SR-080).
    const result = window.locator(".result");
    await expect(result.locator(".line")).toHaveText([
      "added1",
      "SR-0000b2Warn of storms",
      "replaced1",
      `SR-0000a1${K1} · replacement: SR-0000b1 ${A1}`,
      "excluded1",
      "SR-0000a2Measure the wind",
      "incompletefalse",
    ]);
    const [k1Before, a1Before] = [await file("SR-0000000000a1.md"), await file("SR-0000000000b1.md")];
    // Down to the replaced row, then Enter.
    await result.focus();
    for (let line = 0; line < 4; line += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(result.locator(".line[data-cursor]")).toHaveClass(/pair/u);
    await window.keyboard.press("Enter");
    const left = window.locator('[data-area="left"]');
    const right = window.locator('[data-area="right"]');
    await shownReadOnly(left, K1, "within 10 ms.", "then the station answers within 10 ms");
    await shownReadOnly(right, A1, "On the coast", "then the station answers within 20 ms");
    const modeline = window.getByLabel("Modeline");
    await expect(modeline).toContainText("SR-0000a1");
    await expect(modeline).toContainText("read-only");
    // Typing into either buffer changes nothing.
    await left.locator(".cm-content").first().click();
    await window.keyboard.insertText("X");
    await right.locator(".cm-content").first().click();
    await expect(modeline).toContainText("SR-0000b1");
    await expect(modeline).toContainText("read-only");
    await window.keyboard.insertText("Y");
    await expect(left.locator("article h1")).toHaveText(K1);
    expect(await file("SR-0000000000a1.md")).toBe(k1Before);
    expect(await file("SR-0000000000b1.md")).toBe(a1Before);
  });
});
