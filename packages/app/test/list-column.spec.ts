// Lists in the quiet column (SR-148, D-062) on the built app: the list of all elements, a filtered list,
// search hits and the overview stand in the centred column of the open element, under a heading that says
// what they show; a narrow buffer gives them its full width; the matrix and the graph keep the full width.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };
const ELEMENT = "See the wind";

const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');

interface Box {
  readonly x: number;
  readonly width: number;
}

const box = async (locator: Locator): Promise<Box> => {
  const found = await locator.boundingBox();
  if (found === null) {
    throw new Error("not visible");
  }
  return found;
};

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
};

const goTo = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

const resize = async (running: RunningApp, width: number): Promise<void> => {
  await running.app.evaluate(({ BrowserWindow }, to) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(to, 800);
  }, width);
};

/** The column of the shown buffer and the buffer itself. */
const column = async (window: Page): Promise<{ column: Box; buffer: Box }> => ({
  column: await box(shownBuffer(window).locator(".column").first()),
  buffer: await box(shownBuffer(window)),
});

/** The shown buffer scrolls not sideways. */
const noSideScroll = (window: Page): Promise<boolean> =>
  shownBuffer(window).evaluate((buffer) => buffer.scrollWidth <= buffer.clientWidth);

test.describe("lists in the quiet column", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-148/AK1] all elements, a filtered list, search hits and the overview stand in the column of the open element", async () => {
    const { window } = running;
    await resize(running, 1400);
    // The overview, then the list of a type from it: the heading names the type as the metamodel does.
    const overview = await column(window);
    await window.locator(".overview .line.type").first().click();
    await expect(shownBuffer(window).locator("h1")).toContainText(/^[A-Z][A-Za-z ]+ \d+$/);
    await expect(shownBuffer(window).locator("h1")).not.toContainText("type:");
    const typed = await column(window);
    await listAll(window);
    await expect(shownBuffer(window).locator("h1")).toHaveText("All elements 14");
    const all = await column(window);
    await command(window, "Filter list by type");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Type");
    await window.keyboard.type("system-requirement");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window).locator("h1")).toHaveText(/^type: system-requirement \d+$/);
    const filtered = await column(window);
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window).locator("h1")).toContainText("Search: wind");
    const hits = await column(window);
    await goTo(window, ELEMENT);
    const element = await box(window.locator("article .column").first());
    for (const shown of [overview, typed, all, filtered, hits]) {
      expect(shown.column.width).toBeCloseTo(element.width, 0);
      expect(shown.column.x).toBeCloseTo(element.x, 0);
      // A free margin on both sides.
      expect(shown.column.x - shown.buffer.x).toBeGreaterThan(40);
      expect(shown.buffer.x + shown.buffer.width - (shown.column.x + shown.column.width)).toBeGreaterThan(40);
    }
  });

  test("[SR-148/AK2] in a buffer narrower than the column, a list takes its full width without scrolling sideways", async () => {
    const { window } = running;
    await resize(running, 420);
    await listAll(window);
    const { column: shown, buffer } = await column(window);
    // The buffer's own padding is the only margin.
    expect(shown.x - buffer.x).toBeLessThanOrEqual(16);
    expect(buffer.x + buffer.width - (shown.x + shown.width)).toBeLessThanOrEqual(32);
    expect(await noSideScroll(window)).toBe(true);
  });

  test("[SR-148/AK3] the matrix and the graph take the full width of the buffer", async () => {
    const { window } = running;
    await resize(running, 1400);
    await listAll(window);
    await command(window, "Show traceability matrix");
    const matrix = window.locator(".buffer.matrix");
    await expect(matrix).toBeVisible();
    await expect(matrix.locator(".column")).toHaveCount(0);
    const sheet = await box(window.locator('[aria-label="Sheet"]'));
    expect((await box(matrix)).width).toBeCloseTo(sheet.width, 0);
    await goTo(window, ELEMENT);
    await window.keyboard.press("ControlOrMeta+Shift+G");
    const graph = window.locator(".buffer.graph");
    await expect(graph).toBeVisible();
    await expect(graph.locator(".column")).toHaveCount(0);
    expect((await box(graph)).width).toBeCloseTo(sheet.width, 0);
  });
});
