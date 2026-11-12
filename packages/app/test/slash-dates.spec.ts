// The dates of the slash menu (SR-200) on the built app: "Today" writes the computer's day, "Date" opens a
// month calendar at the caret that the arrows operate, Enter or a click writes the day, Escape leaves the
// `/` and its query. A light screenshot of the calendar goes to `test-results/electron/screenshots/` (or
// REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILES, DEMO_TITLE } from "./support/demo.js";
import { expectNextToLine } from "./support/tooltip-place.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Opens the demo element and puts the cursor at the end of its text, on the empty last line. */
const editing = async (window: Page): Promise<void> => {
  await listAll(window);
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator(".cm-content")).toBeFocused();
};

/** The day `days` after today on the computer, as YYYY-MM-DD, worked out in the window. */
const day = (window: Page, days = 0): Promise<string> =>
  window.evaluate((offset) => {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
      .join("-");
  }, days);

const calendar = (window: Page): Locator => window.locator(".cm-lr-calendar");
const chosen = (window: Page): Locator => calendar(window).locator('[aria-selected="true"]');
const lastLine = (window: Page): Locator => window.locator(".cm-line").last();

/** Types `/date`, takes "Date" and waits for the calendar. */
const openCalendar = async (window: Page): Promise<void> => {
  await window.keyboard.type("/date");
  await expect(window.locator('.cm-tooltip-autocomplete li[aria-selected="true"]')).toContainText("Date");
  await window.keyboard.press("Enter");
  await expect(calendar(window)).toBeVisible();
};

test.describe("the dates of the slash menu", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await editing(running.window);
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-200/AK-dnvq] Today writes today's date of the computer as YYYY-MM-DD in place of the / and its query", async () => {
    const { window } = running;
    await window.keyboard.type("/today");
    await expect(window.locator('.cm-tooltip-autocomplete li[aria-selected="true"]')).toContainText("Today");
    await window.keyboard.press("Enter");
    await expect(lastLine(window)).toHaveText(await day(window));
    await expect(lastLine(window)).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("[SR-200/AK-k8gq] Date opens a month calendar at the caret with today chosen; Left, Right, Up and Down move by a day and a week", async () => {
    const { window } = running;
    await openCalendar(window);
    await expect(chosen(window)).toHaveAttribute("data-day", await day(window));
    await expect(calendar(window).locator('[aria-current="date"]')).toHaveAttribute(
      "data-day",
      await day(window),
    );
    // The calendar is right under the line of the `/` (above it when there is no room below), at its start.
    await expectNextToLine(calendar(window), lastLine(window));
    await window.screenshot({ path: path.join(OUT, "sr-200-calendar-light.png") });
    await window.keyboard.press("ArrowRight");
    await expect(chosen(window)).toHaveAttribute("data-day", await day(window, 1));
    await window.keyboard.press("ArrowDown");
    await expect(chosen(window)).toHaveAttribute("data-day", await day(window, 8));
    await window.keyboard.press("ArrowLeft");
    await window.keyboard.press("ArrowLeft");
    await expect(chosen(window)).toHaveAttribute("data-day", await day(window, 6));
    // Across a month: five weeks back is always in an earlier month.
    for (let step = 0; step < 5; step += 1) {
      await window.keyboard.press("ArrowUp");
    }
    await expect(chosen(window)).toHaveAttribute("data-day", await day(window, 6 - 35));
    // The text waits as typed.
    await expect(lastLine(window)).toHaveText("/date");
  });

  test("[SR-200/AK-gx03] Enter writes the chosen day in place of the / and its query", async () => {
    const { window } = running;
    await openCalendar(window);
    await window.keyboard.press("ArrowRight");
    await window.keyboard.press("Enter");
    await expect(calendar(window)).toHaveCount(0);
    await expect(lastLine(window)).toHaveText(await day(window, 1));
    await expect(window.locator(".cm-content")).toBeFocused();
  });

  test("[SR-200/AK-gx03] a click on a day writes that day", async () => {
    const { window } = running;
    await openCalendar(window);
    // The last day shown that is not today.
    const other = calendar(window).locator('[data-day]:not([aria-current="date"])').last();
    const target = String(await other.getAttribute("data-day"));
    expect(target).not.toBe(await day(window));
    await other.click();
    await expect(calendar(window)).toHaveCount(0);
    await expect(lastLine(window)).toHaveText(target);
  });

  test("[SR-200/AK-gx03] Escape closes the calendar, and the / and its query stay as typed", async () => {
    const { window } = running;
    await openCalendar(window);
    await window.keyboard.press("Escape");
    await expect(calendar(window)).toHaveCount(0);
    await expect(lastLine(window)).toHaveText("/date");
    await expect(window.locator(".cm-content")).toBeFocused();
  });
});
