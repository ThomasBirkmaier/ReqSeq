// The context menu of a list outside its rows (SR-198) on the built app: on the heading of a list, of a group,
// of a search and of the elements of a package page it offers to filter, sort and group the list, "Ungroup
// list" in place of "Group list" on a grouped list and "Clear all list filters" on a filtered one (AK1).
// Right-clicks go through Chromium's input (Playwright's mouse), so the `contextmenu` is the one a person's
// click gives.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll } from "./support/app.js";

/** 14 elements: 6 draft, 7 approved, 1 obsolete (fixtures/README.md); the package Sensors holds two. */
const FIXTURE = { fixture: "SR-069/filter" };

const FILTERS = ["Filter list by type", "Filter list by status", "Filter list by text search"];
const ALL = "All commands…";

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entries = (window: Page): Locator => menu(window).getByRole("menuitem");
const entryNames = (window: Page): Promise<string[]> => entries(window).locator(".name").allTextContents();
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');

/** Right-clicks `target` and waits for the menu. */
const rightClick = async (target: Locator): Promise<void> => {
  await target.click({ button: "right" });
  await expect(menu(target.page())).toBeVisible();
};

/** The entries of the menu of `target`; the menu closes again. */
const menuOf = async (target: Locator): Promise<string[]> => {
  const window = target.page();
  await rightClick(target);
  const names = await entryNames(window);
  await window.keyboard.press("Escape");
  await expect(menu(window)).toBeHidden();
  return names;
};

/** Chooses `name` in the menu of `target`, then `value` in the prompt `label` it opens. */
const fromMenu = async (target: Locator, name: string, label: string, value: string): Promise<void> => {
  const window = target.page();
  await rightClick(target);
  await entries(window).filter({ hasText: name }).first().click();
  await expect(menu(window)).toBeHidden();
  await expect(window.locator("label.prompt-label")).toHaveText(label);
  await window.keyboard.type(value);
  await expect(candidates(window).first()).toHaveText(value);
  await window.keyboard.press("Enter");
};

test.describe("the context menu of a list", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-198/AK1] outside the rows a list offers to filter, sort and group, to ungroup when grouped and to clear its filters when filtered", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await listAll(window);
    const heading = shownBuffer(window).locator("h1");
    const rows = shownBuffer(window).locator(".row:not(.fold-row)");
    await expect(rows.first()).toBeVisible();
    const plain = await rows.count();
    expect(await menuOf(heading)).toEqual([...FILTERS, "Sort list", "Group list", ALL]);

    // Grouped from the menu: "Ungroup list" in place of "Group list", on the heading and on a group's heading.
    await fromMenu(heading, "Group list", "Group by", "Status");
    const groups = shownBuffer(window).locator(".group h2");
    await expect(groups).toHaveText(["Draft 6", "Approved 7"]);
    const grouped = [...FILTERS, "Sort list", "Ungroup list", ALL];
    expect(await menuOf(heading)).toEqual(grouped);
    expect(await menuOf(groups.first())).toEqual(grouped);
    await rightClick(heading);
    await entries(window).filter({ hasText: "Ungroup list" }).click();
    await expect(groups).toHaveCount(0);

    // Filtered from the menu, by one step: "Clear all list filters" too, which gives the whole list again.
    await fromMenu(heading, "Filter list by status", "Status", "draft");
    await expect(rows).toHaveCount(6);
    expect(await menuOf(heading)).toEqual([
      ...FILTERS,
      "Sort list",
      "Group list",
      "Clear all list filters",
      ALL,
    ]);
    await rightClick(heading);
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-list-light.png") });
    await entries(window).filter({ hasText: "Clear all list filters" }).click();
    await expect(rows).toHaveCount(plain);

    // A search: its hits are not sorted (SR-124 AK4), so the menu has no "Sort list".
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window).locator(".row").first()).toBeVisible();
    expect(await menuOf(shownBuffer(window).locator("h1"))).toEqual([...FILTERS, "Group list", ALL]);

    // The elements of a package page: on their heading, without groups (SR-112).
    await goTo(window);
    await window.keyboard.type("Sensors");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Sensors");
    await window.keyboard.press("Enter");
    const members = window.locator(".members h2");
    await expect(members).toBeVisible();
    expect(await menuOf(members)).toEqual([...FILTERS, "Sort list", ALL]);
  });
});
