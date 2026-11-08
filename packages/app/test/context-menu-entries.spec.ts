// The context menu of an element as an entry (SR-197) on the built app: a row of a list, a search hit, a node
// of the graph, an entry of a package page, the head of a row of the matrix and a connected element in a cell
// have the same entries for that element, in the same order (AK1); "Show element" opens it in the area of the
// entry, as Enter on the selected entry does (AK2). Right-clicks go through Chromium's input (Playwright's
// mouse), so the `contextmenu` is the one a person's click gives.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

const ENTRIES = [
  "Show element",
  "Show graph",
  "Show neighbourhood",
  "Show affected elements",
  "Create relation",
  "Set status",
  "All commands…",
];

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entries = (window: Page): Locator => menu(window).getByRole("menuitem");
const entryNames = (window: Page): Promise<string[]> => entries(window).locator(".name").allTextContents();
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"]');
const modeline = (window: Page): Locator => window.getByLabel("Modeline");

/** Right-clicks `target` and waits for the menu. */
const rightClick = async (target: Locator): Promise<void> => {
  await target.click({ button: "right" });
  await expect(menu(target.page())).toBeVisible();
};

/** Clicks the entry `name` of the open menu with the left button. */
const choose = async (window: Page, name: string): Promise<void> => {
  await entries(window).filter({ hasText: name }).first().click();
  await expect(menu(window)).toBeHidden();
};

/** Runs `name` from the command prompt. */
const fromCommandLine = async (window: Page, name: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(name);
  await expect(candidates(window).first().locator(".name")).toHaveText(name);
  await window.keyboard.press("Enter");
};

/** Opens the element `title` with Go to. */
const openElement = async (window: Page, title: string): Promise<void> => {
  await goTo(window);
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1").first()).toHaveText(title);
};

/** The menu of `target` has the entries of an element, and closes again. */
const hasEntries = async (target: Locator): Promise<void> => {
  const window = target.page();
  await rightClick(target);
  expect(await entryNames(window)).toEqual(ENTRIES);
  await window.keyboard.press("Escape");
  await expect(menu(window)).toBeHidden();
};

/** What the window shows: the areas with their buffers and which is active, and the modeline. */
const shown = async (window: Page): Promise<Record<string, unknown>> => ({
  areas: await window.locator("[data-area]").evaluateAll((areas) =>
    areas.map((area) => ({
      side: area.getAttribute("data-area"),
      active: area.hasAttribute("data-active"),
      heading:
        area.querySelector("article h1")?.textContent ??
        area.querySelector("[aria-label]")?.getAttribute("aria-label"),
    })),
  ),
  modeline: await modeline(window).textContent(),
});

/** What the window shows once it has stopped changing (counts load after the buffer). */
const settled = async (window: Page): Promise<Record<string, unknown>> => {
  let before = JSON.stringify(await shown(window));
  for (;;) {
    await window.waitForTimeout(300);
    const now = await shown(window);
    if (JSON.stringify(now) === before) {
      return now;
    }
    before = JSON.stringify(now);
  }
};

test.describe("the context menu of an element as an entry", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-197/AK1] a list row, a search hit, a graph node, a package entry and the matrix's heads and connected elements have the same entries for that element", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    // A row of a list; its commands act on it: "Show graph" shows its graph.
    await listAll(window);
    const row = window.locator(".row").nth(2);
    const rowTitle = (await row.locator(".title").textContent()) ?? "";
    await hasEntries(row);
    await rightClick(row);
    await choose(window, "Show graph");
    await expect(window.locator(".graph")).toBeVisible();
    await expect(window.locator('.graph-node[aria-selected="true"] .graph-title')).toHaveText(rowTitle);

    // A node of the graph, not the one the graph is of: "Show neighbourhood" shows the node's.
    // Pinned by its key: once right-clicked, it is the selected one.
    const key = await window
      .locator('.graph-node:not([aria-selected="true"])')
      .first()
      .getAttribute("data-node");
    const node = window.locator(`.graph-node[data-node="${key ?? ""}"]`);
    const nodeTitle = (await node.locator(".graph-title").textContent()) ?? "";
    await hasEntries(node);
    await rightClick(node);
    await choose(window, "Show neighbourhood");
    await expect(modeline(window)).toContainText(nodeTitle);

    // A search hit.
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await expect(window.locator(".row").nth(1)).toBeVisible();
    await hasEntries(window.locator(".row").nth(1));

    // An entry of a package page: "Set status" asks for the entry's status, not the package's.
    await openElement(window, "Sensors");
    const entry = window.locator(".members .row").nth(1);
    const entryId = (await entry.locator(".id").textContent()) ?? "";
    await hasEntries(entry);
    await rightClick(entry);
    await choose(window, "Set status");
    await expect(candidates(window).first().locator(".name")).toContainText(entryId);
    await window.keyboard.press("Escape");

    // The matrix: the head of a row and a connected element in a cell.
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+T");
    const head = window.locator(".matrix td.element .target").first();
    await expect(head).toBeVisible();
    await hasEntries(head);
    await hasEntries(window.locator(".matrix td.cell .target").first());
  });

  test("[SR-197/AK2] in a split window, Show element opens the element in the area of the entry, as Enter on it does", async () => {
    /** The list of all elements in the inactive area of a split window, the overview in the active one. */
    const splitWithList = async (window: Page): Promise<Locator> => {
      await listAll(window);
      await fromCommandLine(window, "Split window");
      await expect(window.locator("[data-area]")).toHaveCount(2);
      await fromCommandLine(window, "Other window");
      const area = window.locator("[data-area]:not([data-active])");
      await expect(area.locator(".row").first()).toBeVisible();
      return area;
    };

    // By keyboard: into the list's area, the third row selected, Enter.
    running = await launchApp(FIXTURE);
    let window = running.window;
    let area = await splitWithList(window);
    const side = await area.getAttribute("data-area");
    await fromCommandLine(window, "Other window");
    await expect(window.locator(`[data-area="${side ?? ""}"]`)).toHaveAttribute("data-active", "");
    const listed = window.locator(`[data-area="${side ?? ""}"] .row`);
    for (let step = 0; step < 3; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(listed.nth(2)).toHaveAttribute("aria-selected", "true");
    const title = (await listed.nth(2).locator(".title").textContent()) ?? "";
    await window.keyboard.press("Enter");
    await expect(window.locator(`[data-area="${side ?? ""}"] article h1`)).toHaveText(title);
    const byKeyboard = await settled(window);
    await running.close();

    // From the menu of the same row, right-clicked in the inactive area.
    running = await launchApp(FIXTURE);
    window = running.window;
    area = await splitWithList(window);
    expect(await area.getAttribute("data-area")).toBe(side);
    await rightClick(area.locator(".row").nth(2));
    await choose(window, "Show element");
    await expect(window.locator(`[data-area="${side ?? ""}"] article h1`)).toHaveText(title);
    expect(await settled(window)).toEqual(byKeyboard);
  });

  test("the menu of an entry in light, as a screenshot", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await openElement(window, "Sensors");
    await rightClick(window.locator(".members .row").nth(1));
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-entry-light.png") });
  });
});
