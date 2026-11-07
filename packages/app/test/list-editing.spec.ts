// Editing lists in the element buffer (SR-187) on the built app: Tab and Alt+arrows, and a real mouse drag of an
// item by its bullet, with the saved file and one undo. A light-theme screenshot during the drag is the evidence
// for the PR. Keys use ControlOrMeta, so the same tests run on Linux, macOS and Windows.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

const TEXT = "Messpunkte:\n\n- Nord\n  - Mast\n- Ost\n- Süd\n";

const FIXTURE = { fixture: "SR-069/filter", files: { [DEMO_FILE]: `${DEMO_FRONT_MATTER}${TEXT}` } };

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const open = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
};

const saved = async (running: RunningApp): Promise<string> => {
  await running.window.keyboard.press("ControlOrMeta+s");
  await expect(running.window.getByLabel("Minibuffer")).toContainText("Saved");
  const file = await fs.readFile(path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/")), "utf8");
  return file.slice(file.indexOf("Messpunkte"));
};

test.describe("list editing in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await open(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-187/AK3] an item dragged by its bullet lands with its sub-items at the new place, and one undo takes it back", async () => {
    const { window } = running;
    const bullets = window.locator(".cm-lr-bullet");
    await expect(bullets).toHaveCount(4);
    // Nord (with Mast) below Süd.
    const from = await bullets.nth(0).boundingBox();
    const sued = await window.locator(".cm-line", { hasText: "Süd" }).boundingBox();
    expect(from).not.toBeNull();
    expect(sued).not.toBeNull();
    if (from === null || sued === null) {
      return;
    }
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await window.mouse.down();
    await window.mouse.move(from.x + 4, from.y + 20, { steps: 4 });
    await window.mouse.move(sued.x + 20, sued.y + sued.height * 0.9, { steps: 8 });
    await expect(window.locator(".cm-lr-drop-after")).toHaveCount(1);
    await expect(window.locator(".cm-lr-dragging")).toHaveCount(2);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "list-drag-light.png") });
    await window.mouse.up();
    await expect(window.locator(".cm-lr-dragging")).toHaveCount(0);
    expect(await saved(running)).toBe("Messpunkte:\n\n- Ost\n- Süd\n- Nord\n  - Mast\n");
    await window.locator(".cm-content").focus();
    await window.keyboard.press("ControlOrMeta+z");
    expect(await saved(running)).toBe(TEXT);
  });

  test("[SR-187/AK1] [SR-187/AK2] Tab indents the item at the caret, Alt+Up moves it with its sub-items", async () => {
    const { window } = running;
    await window.locator(".cm-line", { hasText: "Ost" }).click();
    await window.keyboard.press("End");
    await window.keyboard.press("Tab");
    await expect(window.locator(".cm-content")).toBeFocused();
    expect(await saved(running)).toBe("Messpunkte:\n\n- Nord\n  - Mast\n  - Ost\n- Süd\n");
    await window.locator(".cm-line", { hasText: "Süd" }).click();
    await window.keyboard.press("Alt+ArrowUp");
    expect(await saved(running)).toBe("Messpunkte:\n\n- Süd\n- Nord\n  - Mast\n  - Ost\n");
  });
});
