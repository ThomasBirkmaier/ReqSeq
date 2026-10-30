// Variants on the built app (SR-039) on fixtures/SR-040/validity (standard model; core requirements
// and the variants Coast, Mountain and Desert). A variant is created with "Create element" of the
// command prompt; what the app wrote is read back with the CLI (SR-080). Records per variant (SR-047) on
// fixtures/SR-043/example with an evidence location, where Coast (VAR-0000c1) replaces K1 (SR-0000a1)
// by A1 (SR-0000b1) and excludes K2 (SR-0000a2). Keys use ControlOrMeta, so the same tests run on Linux
// and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
};

test.describe("variants on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-040/validity" });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-039/AK1] element.create of type variant writes a variant file in the workspace of the core", async () => {
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Create element");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Create element");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Variant");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Variant");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Valley");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Valley");
    const found = await cliJson<{ hits: { id: string; title: string }[] }>(running, [
      "element",
      "search",
      "Valley",
    ]);
    const hit = found.hits.find((candidate) => candidate.title === "Valley");
    const got = await cliJson<{ element: { type: string; repository: string; file: string } }>(running, [
      "element",
      "get",
      hit?.id ?? "",
    ]);
    const core = await cliJson<{ element: { repository: string } }>(running, ["element", "get", "SR-000a11"]);
    expect([got.element.type, got.element.repository]).toEqual(["variant", core.element.repository]);
    expect(got.element.file).toMatch(/^variant\/VAR-[0-9a-f]{12}\.md$/);
  });
});

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const label = (window: Page) => window.locator("label.prompt-label");

/** Waits until the prompt asks for `next` (an argument, or "more arguments"). */
const asks = async (window: Page, next: string): Promise<void> => {
  await expect(label(window)).toHaveText(new RegExp(`· ${next}:$`, "u"));
};

/**
 * Picks the first candidate after typing `text`, once it is `name`, and waits for the prompt of `next`:
 * an Enter on the hits of an older text waits for the answer to the typed one, and typing before that
 * answer cancels the Enter (SR-119), so the next text must not be typed until the prompt moved on.
 */
const pick = async (window: Page, text: string, name: string, next: string): Promise<void> => {
  await window.keyboard.type(text);
  await expect(names(window).first()).toHaveText(name);
  await window.keyboard.press("Enter");
  await asks(window, next);
};

/** Runs "Record evidence" of a passed test of `title` (`ref`) for the variant Coast from the command prompt. */
const recordForCoast = async (window: Page, ref: string, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Record evidence");
  await expect(names(window).first()).toHaveText("Record evidence");
  // Ctrl/Cmd+Enter offers the optional arguments after the required ones.
  await window.keyboard.press("ControlOrMeta+Enter");
  await asks(window, "ref");
  await pick(window, title, `${ref} ${title}`, "kind");
  await pick(window, "verification", "verification", "result");
  await pick(window, "passed", "passed", "more arguments");
  await pick(window, "method", "method", "method");
  await pick(window, "test", "test", "more arguments");
  await pick(window, "item", "item", "item");
  await window.keyboard.type("build-47");
  await window.keyboard.press("Enter");
  await asks(window, "more arguments");
  await pick(window, "variant", "variant", "variant");
  await window.keyboard.type("Coast");
  await expect(names(window).first()).toHaveText("VAR-0000c1 Coast");
  await window.keyboard.press("Enter");
  await asks(window, "more arguments");
  // Run: the refusal asks the variant again, with core's message in front.
  await pick(window, "Run", "Run", "variant");
};

const WORKSPACE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n";

test.describe("records per variant in the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({
      fixture: "SR-043/example",
      files: { "reqseq-workspace.yaml": WORKSPACE, "evidence/.keep": "" },
    });
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-047/AK4] evidence.record for C refuses a core requirement excluded or replaced in C, naming the exclusion or the replacement", async () => {
    const { window } = running;
    await recordForCoast(window, "SR-0000a2", "Measure the wind");
    await expect(label(window)).toContainText(
      "SR-0000a2 is excluded in VAR-0000c1, so a record for it there would count nowhere (SR-047)",
    );
    await window.keyboard.press("Escape");
    await recordForCoast(window, "SR-0000a1", "Response time at most 10 ms");
    await expect(label(window)).toContainText(
      "SR-0000a1 is replaced in VAR-0000c1 by SR-0000b1, so a record for it there would count nowhere; record SR-0000b1 instead (SR-047)",
    );
    expect(await fs.readdir(path.join(running.workspace?.root ?? "", "evidence"))).toEqual([".keep"]);
  });
});
