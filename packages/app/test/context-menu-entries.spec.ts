// The context menu of an element as an entry (SR-197) on the built app: a row of a list, a search hit, a node
// of the graph, an entry of a package page, the head of a row of the matrix and a connected element in a cell
// have the same entries for that element, in the same order (AK1); "Show element" opens it in the area of the
// entry, as Enter on the selected entry does (AK2). Right-clicks go through Chromium's input (Playwright's
// mouse), so the `contextmenu` is the one a person's click gives.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll, shownLayer } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

/** "Measure the gusts" derives from "See the wind" (its parent) and lies in the package Sensors. */
const GUSTS = "Measure the gusts";
const WITH_LINKS = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-00000000f197.md": [
      "---",
      "id: 69069069-0000-4000-8000-00000000f197",
      "type: system-requirement",
      "status: draft",
      `title: ${GUSTS}`,
      "requirement-type: functional",
      "acceptance-criteria:",
      "  - Given a gust, when it is checked, then it holds.",
      "derives-from:",
      "  - { id: 69069069-0000-4000-8000-0000000000a1, version: n1:1111111111111111 }",
      "packages:",
      "  - { id: 69069069-0000-4000-8000-0000000000d1, version: n1:1111111111111111 }",
      "---",
      "",
      "Gusts are measured.",
      "",
    ].join("\n"),
  },
};

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
  await expect(shownLayer(window).locator("article h1").first()).toHaveText(title);
};

/**
 * The menu of `target` has the entries of an element, then `after` (what the place adds, SR-199), and closes
 * again.
 */
const hasEntries = async (target: Locator, after: readonly string[] = []): Promise<void> => {
  const window = target.page();
  await rightClick(target);
  expect(await entryNames(window)).toEqual([...ENTRIES.slice(0, -1), ...after, ...ENTRIES.slice(-1)]);
  await window.keyboard.press("Escape");
  await expect(menu(window)).toBeHidden();
};

/**
 * "All commands…" from the menu of `target` lists what Ctrl/Cmd+Shift+P lists on the buffer, each name once
 * (SR-194 AK3): the menu's entry does not add its actions to the prompt.
 */
const allCommandsAsPrompt = async (target: Locator): Promise<void> => {
  const window = target.page();
  await rightClick(target);
  await choose(window, "All commands…");
  await expect(window.locator(".prompt-input")).toHaveValue("");
  const fromMenu = await candidates(window).locator(".name").allTextContents();
  await window.keyboard.press("Escape");
  // The entry selected again, as the menu left it (Escape in a package page's prompt can drop its selection).
  await rightClick(target);
  await window.keyboard.press("Escape");
  await expect(menu(window)).toBeHidden();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await expect(window.locator(".prompt-input")).toHaveValue("");
  expect(await candidates(window).locator(".name").allTextContents()).toEqual(fromMenu);
  await window.keyboard.press("Escape");
  expect(fromMenu.length).toBeGreaterThan(3);
  expect(new Set(fromMenu).size).toBe(fromMenu.length);
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
  for (let tries = 0; tries < 20; tries += 1) {
    await window.waitForTimeout(300);
    const now = await shown(window);
    if (JSON.stringify(now) === before) {
      return now;
    }
    before = JSON.stringify(now);
  }
  throw new Error(`the window did not settle: ${before}`);
};

test.describe("the context menu of an element as an entry", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-197/AK-w7yx] a list row, a search hit, a graph node, a package entry and the matrix's heads and connected elements have the same entries for that element", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    // A row of a list; its commands act on it: "Show graph" shows its graph.
    await listAll(window);
    const row = shownLayer(window).locator(".row").nth(2);
    const rowTitle = (await row.locator(".title").textContent()) ?? "";
    await hasEntries(row);
    await rightClick(row);
    await choose(window, "Show graph");
    await expect(shownLayer(window).locator(".graph")).toBeVisible();
    await expect(shownLayer(window).locator('.graph-node[aria-selected="true"] .graph-title')).toHaveText(
      rowTitle,
    );

    // A node of the graph, not the one the graph is of: "Show neighbourhood" shows the node's.
    // Pinned by its key: once right-clicked, it is the selected one.
    const key = await shownLayer(window)
      .locator('.graph-node:not([aria-selected="true"])')
      .first()
      .getAttribute("data-node");
    const node = shownLayer(window).locator(`.graph-node[data-node="${key ?? ""}"]`);
    const nodeTitle = (await node.locator(".graph-title").textContent()) ?? "";
    await hasEntries(node);
    await allCommandsAsPrompt(node);
    await rightClick(node);
    await choose(window, "Show neighbourhood");
    await expect(modeline(window)).toContainText(nodeTitle);

    // A search hit.
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".row").nth(1)).toBeVisible();
    await hasEntries(shownLayer(window).locator(".row").nth(1));

    // An entry of a package page: "Set status" asks for the entry's status, not the package's.
    await openElement(window, "Sensors");
    const entry = shownLayer(window).locator(".members .row").nth(1);
    const entryId = (await entry.locator(".id").textContent()) ?? "";
    await hasEntries(entry);
    await allCommandsAsPrompt(entry);
    await rightClick(entry);
    await choose(window, "Set status");
    await expect(candidates(window).first().locator(".name")).toContainText(entryId);
    await window.keyboard.press("Escape");

    // The matrix: the head of a row and a connected element in a cell.
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+T");
    const head = shownLayer(window).locator(".matrix td.element .target").first();
    await expect(head).toBeVisible();
    await hasEntries(head);
    // A connected element: "Show graph" shows its graph, not the one of its row.
    const target = shownLayer(window).locator(".matrix td.cell .target").first();
    const targetLabel = (await target.textContent()) ?? "";
    const rowId = (await target.locator("xpath=ancestor::tr").locator("td.element .id").textContent()) ?? "";
    // SR-199 AK4 adds "Remove relation" after the entries of the element.
    await hasEntries(target, ["Remove relation"]);
    await rightClick(target);
    await choose(window, "Show graph");
    await expect(shownLayer(window).locator(".graph")).toBeVisible();
    const graphOf = shownLayer(window).locator('.graph-node[aria-selected="true"] .graph-id');
    const graphId = ((await graphOf.textContent()) ?? "").split(" · ")[0] ?? "";
    expect(graphId).not.toBe("");
    expect(targetLabel).toContain(graphId);
    expect(graphId).not.toBe(rowId);
  });

  test("[SR-197/AK-w7yx] a row of the overview and of the neighbourhood have the same entries for that element", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    // A row of the neighbourhood of "See the wind": its children.
    await openElement(window, "See the wind");
    await window.keyboard.press("ControlOrMeta+J");
    const child = shownLayer(window).locator(".neighbourhood .row").first();
    await expect(child).toBeVisible();
    await hasEntries(child);
    // A recent row of the overview; "Show element" opens its element.
    await fromCommandLine(window, "Show overview");
    const recent = shownLayer(window).locator(".overview .line.recent", { hasText: "See the wind" });
    await expect(recent).toBeVisible();
    await hasEntries(recent);
    await rightClick(recent);
    await choose(window, "Show element");
    await expect(shownLayer(window).locator("article h1").first()).toHaveText("See the wind");
  });

  test("[SR-197/AK-frfw] [SR-197/AK-tzn9] a connected element in a group of relations or a relation box has the field's menu; a result row and a parent title have the buffer's", async () => {
    running = await launchApp(WITH_LINKS);
    const { window } = running;
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await openElement(window, GUSTS);
    // AK3: the link in the group "derives-from" and in the box "packages" (a property of kind relation).
    for (const link of [
      shownLayer(window).locator('article [data-field="derives-from"] [role="link"]').first(),
      shownLayer(window).locator('article [data-field="packages"] [role="link"]').first(),
    ]) {
      await expect(link).toBeVisible();
      await rightClick(link);
      const names = await entryNames(window);
      expect(names[0]).toBe("Copy field");
      expect(names).not.toContain("Show element");
      await window.keyboard.press("Escape");
      await expect(menu(window)).toBeHidden();
    }
    await rightClick(shownLayer(window).locator('article [data-field="packages"] [role="link"]').first());
    expect(await entryNames(window)).toContain("Add property");
    await window.keyboard.press("Escape");

    // AK4: a title in the line of the parents has the menu of the buffer, as its empty sheet has.
    const buffer = shownLayer(window, "left").locator(".buffer");
    const box = await buffer.boundingBox();
    await buffer.click({ button: "right", position: { x: 30, y: (box?.height ?? 100) - 30 } });
    await expect(menu(window)).toBeVisible();
    const ofBuffer = await entryNames(window);
    await window.keyboard.press("Escape");
    expect(ofBuffer.slice(0, 3)).toEqual(["Go to element or buffer", "Search elements", "Close buffer"]);
    const parent = shownLayer(window).locator('.parents [role="link"]', { hasText: "See the wind" });
    await expect(parent).toBeVisible();
    await rightClick(parent);
    expect(await entryNames(window)).toEqual(ofBuffer);
    await window.keyboard.press("Escape");

    // AK4: a row of the output of "List hints", which no other buffer shows.
    await fromCommandLine(window, "List hints");
    const line = shownLayer(window).locator(".result .hint").first();
    await expect(line).toBeVisible();
    await rightClick(line);
    const names = await entryNames(window);
    expect(names.slice(0, 3)).toEqual(["Go to element or buffer", "Search elements", "Close buffer"]);
    expect(names).not.toContain("Show element");
    expect(names).not.toContain("Copy field");
  });

  test("[SR-197/AK-pz85] in a split window, Show element opens the element in the area of the entry, as Enter on it does", async () => {
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
    const listed = shownLayer(window, side ?? "").locator(".row");
    for (let step = 0; step < 3; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(listed.nth(2)).toHaveAttribute("aria-selected", "true");
    const title = (await listed.nth(2).locator(".title").textContent()) ?? "";
    await window.keyboard.press("Enter");
    await expect(shownLayer(window, side ?? "").locator("article h1")).toHaveText(title);
    const byKeyboard = await settled(window);
    await running.close();

    // From the menu of the same row, right-clicked in the inactive area.
    running = await launchApp(FIXTURE);
    window = running.window;
    area = await splitWithList(window);
    expect(await area.getAttribute("data-area")).toBe(side);
    await rightClick(area.locator(".row").nth(2));
    await choose(window, "Show element");
    await expect(shownLayer(window, side ?? "").locator("article h1")).toHaveText(title);
    expect(await settled(window)).toEqual(byKeyboard);
  });

  test("the menu of an entry in light, as a screenshot", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await openElement(window, "Sensors");
    await rightClick(shownLayer(window).locator(".members .row").nth(1));
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-entry-light.png") });
  });
});
