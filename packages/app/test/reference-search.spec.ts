// The `[[` search of the editor (SR-066) on the built app: typed `[[` opens "Insert reference", the pick is
// written as an inline reference with ID and version in the saved file, and the editor shows the title,
// also of a local target in another repository (D-058). Keys use ControlOrMeta, so the same tests run on
// Linux and macOS; `[[` is typed with the keyboard, as a person types it (N3 of the plan review).
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import {
  DEMO_FILE,
  DEMO_FILES,
  DEMO_TITLE,
  REFERENCE_FILES,
  REFERENCE_TARGET_ID,
  REFERENCE_TARGET_TITLE,
} from "./support/demo.js";

/** A need in a second repository, `sensor`, next to the workspace (D-058). */
const GUSTS_ID = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
const GUSTS_TITLE = "Böen messen";
const ACROSS_FILES = {
  "reqseq-workspace.yaml": [
    "reqseq-workspace: 1",
    "name: Weather station",
    "repositories:",
    '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
    '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }',
    "metamodel: { repository: system, path: metamodel }",
    "",
  ].join("\n"),
  "../sensor/needs/N-0e9d7c5b3a21.md": `---\nid: ${GUSTS_ID}\ntype: need\nstatus: draft\ntitle: ${GUSTS_TITLE}\n---\n\nDer Sensor misst Böen.\n`,
};

const FIXTURE = { fixture: "SR-069/filter", files: { ...DEMO_FILES, ...REFERENCE_FILES } };
const ACROSS = { fixture: "SR-069/filter", files: { ...DEMO_FILES, ...ACROSS_FILES } };

/** Opens the demo element and puts the cursor at the end of its text, on the empty last line. */
const editing = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await expect(window.locator("article")).toBeFocused();
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
};

const prompt = (window: Page): Locator => window.getByLabel("Insert reference");
const firstCandidate = (window: Page): Locator => window.locator('.candidates [role="option"]').first();
const lastLine = (window: Page): Locator => window.locator(".cm-line").last();
/** The line with the inline reference (the file's final newline follows it after the save). */
const referenceLine = (window: Page): Locator =>
  window.locator(".cm-line", { has: window.locator(".cm-lr-ref") }).last();

/** Types `[[`, picks the first element the query finds, and saves. */
const insertAndSave = async (window: Page, query: string, expected: string): Promise<void> => {
  await window.keyboard.type("[[");
  await expect(prompt(window)).toBeVisible();
  await window.keyboard.type(query);
  await expect(firstCandidate(window)).toContainText(expected);
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
  await window.keyboard.press("ControlOrMeta+s");
  await expect(window.getByLabel("Minibuffer")).toContainText("Saved");
};

const demoFile = (running: RunningApp): Promise<string> =>
  fs.readFile(path.join(running.workspace?.root ?? "", ...DEMO_FILE.split("/")), "utf8");

test.describe("the [[ search in the element buffer", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
    await editing(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-066/AK1] [[ in the text opens Insert reference; a title word and a short ID both find the element", async () => {
    const { window } = running;
    await window.keyboard.type("[[");
    await expect(prompt(window)).toBeVisible();
    await expect(prompt(window)).toBeFocused();
    await window.keyboard.type("Sekunde");
    await expect(firstCandidate(window)).toContainText(REFERENCE_TARGET_TITLE);
    // The row starts with the short ID of the element (its label): it finds the element too.
    const shortId = ((await firstCandidate(window).textContent()) ?? "").trim().split(/\s+/u)[0] ?? "";
    expect(shortId).toMatch(/^N-[0-9a-f]+$/u);
    await window.keyboard.press("ControlOrMeta+a");
    await window.keyboard.type(shortId);
    await expect(firstCandidate(window)).toContainText(REFERENCE_TARGET_TITLE);
    // Escape leaves the [[ as typed, and the editor has the focus.
    await window.keyboard.press("Escape");
    await expect(prompt(window)).toHaveCount(0);
    await expect(window.locator(".cm-content")).toBeFocused();
    await expect(lastLine(window)).toHaveText("[[");
  });

  test("[SR-066/AK2] the saved file holds [Title](reqseq:<uuid>?version=n1:…) where [[ was typed, and the editor shows the title", async () => {
    const { window } = running;
    await window.keyboard.type("Siehe ");
    await insertAndSave(window, REFERENCE_TARGET_TITLE, REFERENCE_TARGET_TITLE);
    const file = await demoFile(running);
    expect(file).toMatch(
      new RegExp(
        `\\nSiehe \\[${REFERENCE_TARGET_TITLE}\\]\\(reqseq:${REFERENCE_TARGET_ID}\\?version=n1:[0-9a-f]+\\)\\n`,
        "u",
      ),
    );
    expect(file).not.toContain("[[");
    // Off the lines with the caret only the title shows (D-061): Escape leaves the text.
    await window.keyboard.press("Escape");
    await expect(referenceLine(window)).toHaveText(`Siehe ${REFERENCE_TARGET_TITLE}`);
    await expect(referenceLine(window).locator(".cm-lr-ref")).toHaveText(REFERENCE_TARGET_TITLE);
  });
});

test.describe("the [[ search with a second repository", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(ACROSS);
    await listAll(running.window);
    await editing(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-066/AK2] a local target in another repository is saved with its short ID and shown with its title", async () => {
    const { window } = running;
    await insertAndSave(window, GUSTS_TITLE, GUSTS_TITLE);
    const file = await demoFile(running);
    expect(file).toMatch(
      new RegExp(
        `\\n\\[N-[0-9a-f]+\\]\\(reqseq:${GUSTS_ID}\\?version=n1:[0-9a-f]+&repository=sensor\\)\\n`,
        "u",
      ),
    );
    expect(file).not.toContain(GUSTS_TITLE);
    await window.keyboard.press("Escape");
    await expect(referenceLine(window)).toHaveText(GUSTS_TITLE);
    await expect(referenceLine(window).locator(".cm-lr-title")).toHaveText(GUSTS_TITLE);
  });
});
