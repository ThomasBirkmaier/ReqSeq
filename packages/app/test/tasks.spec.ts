// Ticking tasks in the element buffer (SR-185) on the built app: a click on the box changes only the marker in
// the saved file, undo brings it back, and "Toggle task" from the command prompt does the same at the caret. A
// light-theme screenshot is the evidence for the PR.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

const TEXT = "Aufgaben:\n\n- [ ] Mast prüfen\n- [x] Sensor tauschen\n";

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
  return file.slice(file.indexOf("Aufgaben"));
};

test.describe("tasks in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await open(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-185/AK1] [SR-185/AK2] a click on a task box ticks it in the file, and undo takes it back", async () => {
    const { window } = running;
    const boxes = window.locator(".cm-lr-task");
    await expect(boxes).toHaveText(["☐", "☑"]);
    await boxes.nth(0).click();
    await expect(boxes).toHaveText(["☑", "☑"]);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "tasks-light.png") });
    expect(await saved(running)).toBe("Aufgaben:\n\n- [x] Mast prüfen\n- [x] Sensor tauschen\n");
    await window.locator(".cm-content").focus();
    await window.keyboard.press("ControlOrMeta+z");
    expect(await saved(running)).toBe(TEXT);
  });

  test("[SR-185/AK3] Toggle task from the command prompt switches the task at the caret", async () => {
    const { window } = running;
    await window.locator(".cm-line", { hasText: "Sensor" }).click();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Toggle task");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Toggle task");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    expect(await saved(running)).toBe("Aufgaben:\n\n- [ ] Mast prüfen\n- [ ] Sensor tauschen\n");
  });
});
