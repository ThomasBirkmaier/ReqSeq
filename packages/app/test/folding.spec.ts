// Folding and jumping to headings in the text (SR-191) on the built app: "Fold section", "Unfold section" and
// "Go to heading" in the command prompt, the toggle left of a heading under the pointer, the hint in place of a
// folded section, and the file, which folding never changes. A light-theme screenshot of a folded section goes
// to `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS) for the pull request.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILE, DEMO_FRONT_MATTER, DEMO_TITLE } from "./support/demo.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const TEXT = `# Übersicht

Einleitung zum Wind.

## Zweck

Der Zweck der Messung.

### Detail

Mehr zum Zweck.

## Umfang

Der Umfang der Messung.
`;

const FILE = `${DEMO_FRONT_MATTER}${TEXT}`;
const FIXTURE = { fixture: "SR-069/filter", files: { [DEMO_FILE]: FILE } };

const opened = async (window: Page): Promise<void> => {
  await listAll(window);
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await expect(window.locator(".cm-content")).toBeVisible();
};

const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(command);
  await window.keyboard.press("Enter");
};

const line = (window: Page, text: string): Locator => window.locator(".cm-line", { hasText: text });

const fileOf = (running: RunningApp): Promise<string> =>
  fs.readFile(path.join(running.workspace?.root ?? "", DEMO_FILE), "utf8");

test.describe("folding and jumping to headings", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await opened(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-191/AK1] Fold section and the toggle under the pointer fold a section to a hint up to the next heading of its level, and the file stays", async () => {
    const { window } = running;
    await line(window, "Der Zweck der Messung.").click();
    await runCommand(window, "Fold section");
    const hint = window.locator(".cm-lr-fold-hint");
    await expect(hint).toHaveText("… 6 lines");
    await expect(window.locator(".cm-content")).not.toContainText("Der Zweck der Messung.");
    await expect(window.locator(".cm-content")).not.toContainText("Mehr zum Zweck.");
    // The next heading of the same level and its section stay.
    await expect(window.locator(".cm-content")).toContainText("Der Umfang der Messung.");
    await expect(window.locator(".candidates")).toHaveCount(0);
    await window.mouse.move(5, 5);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "folded-section.png"), animations: "disabled" });

    // The toggle shows only while the pointer is over its heading; a click on it folds that section.
    const scope = window.locator(".cm-line.cm-lr-h2", { hasText: "Umfang" });
    const toggle = scope.locator(".cm-lr-fold-toggle");
    await window.mouse.move(5, 5);
    await expect(toggle).toHaveCSS("opacity", "0");
    await scope.hover();
    await expect(toggle).toHaveCSS("opacity", "1");
    const box = await toggle.boundingBox();
    const heading = await scope.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((heading?.x ?? 0) + 1);
    await toggle.click();
    await expect(window.locator(".cm-lr-fold-hint")).toHaveCount(2);
    await expect(window.locator(".cm-content")).not.toContainText("Der Umfang der Messung.");
    expect(await fileOf(running)).toBe(FILE);
  });

  test("[SR-191/AK1] the toggle stays while the pointer moves from the heading onto it, and a click there folds and unfolds the section", async () => {
    const { window } = running;
    const scope = window.locator(".cm-line.cm-lr-h2", { hasText: "Zweck" });
    const toggle = scope.locator(".cm-lr-fold-toggle");
    const heading = await scope.boundingBox();
    const y = (heading?.y ?? 0) + (heading?.height ?? 0) / 2;
    // The pointer moves as a hand moves it: in small steps from the heading's text to the toggle, not in one jump.
    await window.mouse.move((heading?.x ?? 0) + 30, y);
    await expect(toggle).toHaveCSS("opacity", "1");
    const box = await toggle.boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    await window.mouse.move(x, y, { steps: 30 });
    await expect(toggle).toHaveCSS("opacity", "1");
    await window.mouse.down();
    await window.mouse.up();
    await expect(window.locator(".cm-lr-fold-hint")).toHaveCount(1);
    await expect(window.locator(".cm-content")).not.toContainText("Der Zweck der Messung.");
    // The pointer has not moved: the folded toggle is under it, and a second click unfolds the section.
    await expect(toggle).toHaveText("▸");
    await expect(toggle).toHaveCSS("opacity", "1");
    await window.mouse.down();
    await window.mouse.up();
    await expect(window.locator(".cm-content")).toContainText("Der Zweck der Messung.");
    await expect(window.locator(".cm-lr-fold-hint")).toHaveCount(0);
    expect(await fileOf(running)).toBe(FILE);
  });

  test("[SR-191/AK2] a folded section opens with Unfold section, a click on its hint, and the cursor moving in", async () => {
    const { window } = running;
    await line(window, "Der Zweck der Messung.").click();
    await runCommand(window, "Fold section");
    await expect(window.locator(".cm-lr-fold-hint")).toHaveCount(1);
    await runCommand(window, "Unfold section");
    await expect(window.locator(".cm-content")).toContainText("Der Zweck der Messung.");
    await expect(window.locator(".cm-lr-fold-hint")).toHaveCount(0);

    await runCommand(window, "Fold section");
    await window.locator(".cm-lr-fold-hint").click();
    await expect(window.locator(".cm-content")).toContainText("Der Zweck der Messung.");

    // "Go to heading" to a heading inside the fold moves the cursor in, and the fold opens.
    await line(window, "Der Zweck der Messung.").click();
    await runCommand(window, "Fold section");
    await expect(window.locator(".cm-content")).not.toContainText("Mehr zum Zweck.");
    await runCommand(window, "Go to heading");
    await window.keyboard.type("Detail");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toContainText("Mehr zum Zweck.");
    await expect(window.locator(".cm-lr-fold-hint")).toHaveCount(0);
    expect(await fileOf(running)).toBe(FILE);
  });

  test("[SR-191/AK3] Go to heading offers the headings with fuzzy matching, and the choice puts the cursor there", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Go to heading");
    await window.keyboard.press("Enter");
    const options = window.locator('.candidates [role="option"]');
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toContainText("Übersicht");
    await expect(options.nth(0)).toContainText("H1");
    await expect(options.nth(2)).toContainText("Detail");
    await expect(options.nth(2)).toContainText("H3");
    // A fuzzy query: the letters in order, not a word of the heading.
    await window.keyboard.type("umfg");
    await expect(options.first()).toContainText("Umfang");
    await window.keyboard.press("Enter");
    // The cursor is on the heading: its line shows its source, the text has the focus.
    await expect(line(window, "## Umfang")).toBeVisible();
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.type("X");
    await expect(line(window, "X## Umfang")).toBeVisible();
  });
});
