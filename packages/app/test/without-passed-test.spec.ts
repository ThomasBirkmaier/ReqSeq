// The requirements without a passed test (SR-120 AK1) on the built app, without a renderer change: the
// command prompt offers the catalog's read command `evidence.withoutPassedTest` by its title and, since it
// needs no argument, runs it on Enter into the result buffer, whose element rows open (SR-073 AK2). From the
// start view (SR-118): Ctrl+Shift+P, the text, Enter. Keys use ControlOrMeta, so the same test runs on Linux
// and macOS. The rule of the list (AK2) is tested in core and CLI.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

/** JUnit runs with a skipped test case and an inspection record; its README lists the elements. */
const FIXTURE = { fixture: "SR-126/matrix" };
const TITLE = "List requirements without passed/no test";

const names = (window: Page) => window.locator('.candidates [role="option"] .name');
const rows = (window: Page) => window.locator(".result .line.element");

test.describe("the requirements without a passed test in the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-120/AK1] Ctrl+Shift+P, the text and Enter show the requirements without a passed test, as the CLI lists them", async () => {
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("without passed test");
    await expect(names(window).first()).toHaveText(TITLE);
    await window.keyboard.press("Enter");
    const listed = JSON.parse((await running.cli(["evidence", "without-passed-test", "--json"])).stdout) as {
      readonly elements: readonly { readonly shortId: string; readonly title: string }[];
    };
    expect(listed.elements.map((e) => e.shortId)).toEqual([
      "SR-126b02",
      "SR-126b04",
      "SR-126b05",
      "SR-126b06",
      "SR-126b07",
    ]);
    await expect(rows(window)).toHaveCount(5);
    expect(await rows(window).locator(".label").allTextContents()).toEqual(
      listed.elements.map((e) => e.shortId),
    );
    expect(await rows(window).locator(".text").allTextContents()).toEqual(
      listed.elements.map((e) => e.title),
    );
    await expect(window.locator(".result")).toContainText("total5");
    // A row opens its element.
    await rows(window).first().click();
    await expect(window.locator("article h1")).toHaveText("Log wind speed");
  });

  test("[SR-120/AK1] the prompt finds the command for the texts passed test and no test as well", async () => {
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    for (const text of ["passed test", "no test"]) {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.keyboard.type(text);
      await expect(names(window).first()).toHaveText(TITLE);
      await window.keyboard.press("Escape");
    }
  });
});
