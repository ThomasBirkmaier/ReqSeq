// The command line by mouse (SR-202) on the built app: a click on the command line at the bottom opens it
// with an empty input and the commands, as Ctrl/Cmd+Shift+P does (AK1); the wheel scrolls its card to every
// command it holds (AK2); a click on a hit acts as Enter on it (AK3). Clicks and the wheel go through
// Chromium's input (Playwright's mouse), as a person's do.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { cardSettled, goTo, launchApp, listAll, modifier } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

const minibuffer = (window: Page): Locator => window.getByLabel("Minibuffer");
const input = (window: Page): Locator => window.locator("#prompt-input");
const label = (window: Page): Locator => window.locator("label.prompt-label");
const options = (window: Page): Locator => window.locator('.candidates [role="option"]');
const names = (window: Page): Promise<string[]> => options(window).locator(".name").allTextContents();
const card = (window: Page): Locator => window.locator(".candidates.card-list");

/**
 * The ID, title and status of each row of the list: what a filter decides. The verification column fills in
 * after the rows appear (#1505), so it is left out.
 */
const rowCells = (window: Page): Promise<string[]> =>
  window
    .locator(".row")
    .evaluateAll((rows) =>
      rows.map((row) =>
        [".id", ".title", ":scope > .status"]
          .map((cell) => row.querySelector(cell)?.textContent ?? "")
          .join(" | "),
      ),
    );

/** Where `locator` is on the page; it must be visible. */
const boxOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("not visible");
  }
  return box;
};

/** The command prompt as Ctrl/Cmd+Shift+P opens it: its label, its input and the names of its rows. */
const byKeys = async (window: Page): Promise<{ label: string; names: string[] }> => {
  await window.keyboard.press(`${await modifier(window)}+Shift+P`);
  await expect(options(window).first()).toBeVisible();
  await expect(input(window)).toBeFocused();
  await expect(input(window)).toHaveValue("");
  const opened = { label: await label(window).innerText(), names: await names(window) };
  await window.keyboard.press("Escape");
  await expect(input(window)).toHaveCount(0);
  return opened;
};

/** Opens an element, so the focus is in a buffer, not on the minibuffer. */
const openElement = async (window: Page): Promise<void> => {
  await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  await goTo(window);
  await window.keyboard.type("Measure wind speed");
  await expect(options(window).first()).toContainText("Measure wind speed");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toContainText("Measure wind speed");
};

test.describe("the command line by mouse", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-202/AK1] a click on the command line opens it empty with the commands, as Ctrl/Cmd+Shift+P does", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await openElement(window);
    const keys = await byKeys(window);
    expect(keys.names.length).toBeGreaterThan(0);
    // Anywhere on the line at the bottom: its left edge, its middle and its right edge.
    const line = await boxOf(minibuffer(window));
    for (const x of [1, line.width / 2, line.width - 1]) {
      await minibuffer(window).click({ position: { x, y: line.height / 2 } });
      await expect(input(window)).toBeFocused();
      await expect(input(window)).toHaveValue("");
      await expect(label(window)).toHaveText(keys.label);
      await expect(options(window).locator(".name")).toHaveText(keys.names);
      await window.keyboard.press("Escape");
      await expect(input(window)).toHaveCount(0);
    }
  });

  test("[SR-202/AK2] the wheel scrolls the card of the empty command line to every command it would find", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const all = (await byKeys(window)).names;
    const line = await boxOf(minibuffer(window));
    await minibuffer(window).click({ position: { x: line.width / 2, y: line.height / 2 } });
    await expect(options(window).locator(".name")).toHaveText(all);
    await cardSettled(window);
    // More commands than the card shows at once, so the wheel has something to reach.
    const shown = await boxOf(card(window));
    const rowHeight = (await boxOf(options(window).first())).height;
    expect(all.length * rowHeight).toBeGreaterThan(shown.height * 2);
    // The names fully inside the card, at each step of the wheel over it, until it moves no further.
    const visible = (): Promise<string[]> =>
      card(window).evaluate((list) => {
        const frame = list.getBoundingClientRect();
        return [...list.querySelectorAll('[role="option"]')]
          .filter((row) => {
            const box = row.getBoundingClientRect();
            return box.top >= frame.top - 0.5 && box.bottom <= frame.bottom + 0.5;
          })
          .map((row) => row.querySelector(".name")?.textContent ?? "");
      });
    const scrolled = (): Promise<number> => card(window).evaluate((list) => list.scrollTop);
    const bottom = await card(window).evaluate((list) => list.scrollHeight - list.clientHeight);
    await window.mouse.move(shown.x + shown.width / 2, shown.y + shown.height / 2);
    const reached = new Set(await visible());
    // Each turn of the wheel moves the card down (it may scroll smoothly), until it is at its end.
    for (let before = await scrolled(); before < bottom - 1; before = await scrolled()) {
      await window.mouse.wheel(0, rowHeight * 3);
      await expect.poll(scrolled).toBeGreaterThan(before);
      for (const name of await visible()) {
        reached.add(name);
      }
    }
    await expect.poll(scrolled).toBeGreaterThanOrEqual(bottom - 1);
    for (const name of await visible()) {
      reached.add(name);
    }
    expect(all.filter((name) => !reached.has(name))).toEqual([]);
    // The wheel moved no selection and closed nothing.
    await expect(options(window).first()).toHaveAttribute("aria-selected", "true");
    await expect(input(window)).toBeFocused();
  });

  test("[SR-202/AK3] a click on a hit of the command line acts as Enter on it", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const modeline = window.getByLabel("Modeline");
    const unfiltered = await window.locator(".row").count();
    // A command that asks an argument: by Enter, then by a click, the same question.
    await window.keyboard.press(`${await modifier(window)}+Shift+P`);
    await window.keyboard.type("Filter list by status");
    await expect(options(window).first().locator(".name")).toHaveText("Filter list by status");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Status");
    const statuses = await names(window);
    // Escape goes back to the commands (SR-134 AK1), a second one closes.
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("Command");
    await window.keyboard.press("Escape");
    await expect(input(window)).toHaveCount(0);
    const line = await boxOf(minibuffer(window));
    await minibuffer(window).click({ position: { x: line.width / 2, y: line.height / 2 } });
    await options(window)
      .filter({ hasText: /^Filter list by status/ })
      .click();
    await expect(label(window)).toHaveText("Status");
    await expect(options(window).locator(".name")).toHaveText(statuses);
    await expect(input(window)).toBeFocused();
    // A hit of that question taken by a click: the list is filtered as Enter on it filters it.
    await options(window)
      .filter({ hasText: statuses[0] ?? "" })
      .first()
      .click();
    await expect(input(window)).toHaveCount(0);
    // The status narrows the list, so the snapshot is of the filtered list.
    await expect(modeline).toContainText(`status: ${statuses[0] ?? ""}`);
    await expect.poll(() => window.locator(".row").count()).toBeLessThan(unfiltered);
    await expect.poll(() => window.locator(".row").count()).toBeGreaterThan(0);
    const clicked = {
      modeline: (await modeline.textContent()) ?? "",
      rows: await rowCells(window),
    };
    await listAll(window);
    await window.keyboard.press(`${await modifier(window)}+Shift+P`);
    await window.keyboard.type("Filter list by status");
    await expect(options(window).first().locator(".name")).toHaveText("Filter list by status");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Status");
    await window.keyboard.press("Enter");
    await expect(input(window)).toHaveCount(0);
    await expect(modeline).toHaveText(clicked.modeline);
    await expect.poll(() => rowCells(window)).toEqual(clicked.rows);
    // A command that runs at once: its result buffer by a click is the one Enter gives.
    await minibuffer(window).click({ position: { x: line.width / 2, y: line.height / 2 } });
    await options(window)
      .filter({ hasText: /^Show workspace status/ })
      .click();
    await expect(input(window)).toHaveCount(0);
    await expect(modeline).toContainText("Show workspace status");
    await expect(window.locator(".result .line").first()).not.toBeEmpty();
    const result = (await window.locator(".result").textContent()) ?? "";
    const ranModeline = (await modeline.textContent()) ?? "";
    await window.keyboard.press(`${await modifier(window)}+Shift+P`);
    await window.keyboard.type("Show workspace status");
    await expect(options(window).first().locator(".name")).toHaveText("Show workspace status");
    await window.keyboard.press("Enter");
    await expect(input(window)).toHaveCount(0);
    await expect(window.locator(".result")).toHaveText(result);
    await expect(modeline).toHaveText(ranModeline);
  });

  test("a press on a hit of the card released over the line opens no command line again", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    await window.keyboard.press(`${await modifier(window)}+Shift+P`);
    await window.keyboard.type("Show workspace status");
    const hit = options(window).first();
    await expect(hit.locator(".name")).toHaveText("Show workspace status");
    // The raw mouse has no wait of its own: the box is read where the card stands, not while it rises.
    await cardSettled(window);
    const row = await boxOf(hit);
    await window.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    // The press takes the hit, as Enter does; the release over the idle line is no click on it.
    await window.mouse.down();
    await expect(input(window)).toHaveCount(0);
    const line = await boxOf(minibuffer(window));
    await window.mouse.move(line.x + line.width / 2, line.y + line.height / 2, { steps: 5 });
    await window.mouse.up();
    await expect(window.getByLabel("Modeline")).toContainText("Show workspace status");
    await expect(input(window)).toHaveCount(0);
  });

  test("the command line opened by a click, in light, as a screenshot", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await listAll(window);
    const line = await boxOf(minibuffer(window));
    await minibuffer(window).click({ position: { x: line.width / 2, y: line.height / 2 } });
    await expect(options(window).first()).toBeVisible();
    await window.mouse.move(line.width / 2, line.y - 80);
    await window.mouse.wheel(0, 200);
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "command-line-mouse-light.png") });
  });
});
