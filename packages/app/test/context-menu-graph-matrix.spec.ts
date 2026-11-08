// The context menu of the graph and the matrix (SR-199) on the built app: on the sheet of an element's graph
// outside its nodes the graph's depth and relation kinds (AK1), on the metamodel's graph "Show metamodel as
// text" (AK2), the export of SR-151 not yet; in a cell of the matrix "Create relation" with the row and the
// column given (AK3); on a connected element in a cell "Remove relation" after the entries of the element
// (AK4). Right-clicks go through Chromium's input (Playwright's mouse), so the `contextmenu` is the one a
// person's click gives.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };
const ALL = "All commands…";

/** The entries of a connected element in the matrix: those of an element (SR-197), then "Remove relation". */
const ENTRY_THEN_REMOVE = [
  "Show element",
  "Show graph",
  "Show neighbourhood",
  "Show affected elements",
  "Create relation",
  "Set status",
  "Remove relation",
  ALL,
];

/** SR-0000b5 of the fixture with two more relations: one of the same kind to another need, one based on D1. */
const WITH_MORE = [
  "---",
  "id: 69069069-0000-4000-8000-0000000000b5",
  "type: system-requirement",
  "status: approved",
  "title: Send data to the cloud",
  "requirement-type: interface",
  "acceptance-criteria:",
  "  - Given a link, when it is checked, then it holds.",
  "source: Supplier A",
  "import-date: 2026-03-01",
  "derives-from:",
  "  - { id: 69069069-0000-4000-8000-0000000000a2, version: n1:1111111111111111 }",
  "  - { id: 69069069-0000-4000-8000-0000000000a1, version: n1:1111111111111111 }",
  "based-on:",
  "  - { id: 69069069-0000-4000-8000-0000000000e1, version: n1:1111111111111111 }",
  "---",
  "",
  "b5: derives from N2, imported.",
  "",
].join("\n");

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entries = (window: Page): Locator => menu(window).getByRole("menuitem");
const entryNames = (window: Page): Promise<string[]> => entries(window).locator(".name").allTextContents();
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"]');
const label = (window: Page): Locator => window.locator("label.prompt-label");

/** Right-clicks `target` (at `position` inside it) and waits for the menu. */
const rightClick = async (target: Locator, position?: { x: number; y: number }): Promise<void> => {
  await target.click({ button: "right", ...(position === undefined ? {} : { position }) });
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

/**
 * A point of `sheet`, near its lower right corner, where nothing but the sheet itself is: no node, no type
 * box, no edge.
 */
const emptyPoint = async (sheet: Locator): Promise<{ x: number; y: number }> => {
  const box = await sheet.boundingBox();
  const point = { x: Math.round((box?.width ?? 40) - 20), y: Math.round((box?.height ?? 40) - 20) };
  const bare = await sheet.evaluate((element, at) => {
    const outer = element.getBoundingClientRect();
    const hit = document.elementFromPoint(outer.left + at.x, outer.top + at.y);
    return hit !== null && hit.closest(".graph-node, .mm-type, path") === null && element.contains(hit);
  }, point);
  expect(bare).toBe(true);
  return point;
};

/** The matrix of all elements: the list of all elements, switched to the matrix with Ctrl/Cmd+T. */
const showMatrix = async (window: Page): Promise<void> => {
  await listAll(window);
  await window.keyboard.press("ControlOrMeta+T");
  await expect(window.locator(".matrix td.cell").first()).toBeVisible();
};

/** The row of the matrix whose element is `id`. */
const matrixRow = (window: Page, id: string): Locator =>
  window.locator(".matrix tbody tr").filter({ has: window.locator("td.element .id", { hasText: id }) });

/** A point of `cell` beside its connected elements. */
const besideTargets = async (cell: Locator): Promise<{ x: number; y: number }> => {
  const box = await cell.boundingBox();
  return { x: Math.round((box?.width ?? 10) - 3), y: Math.round((box?.height ?? 10) - 3) };
};

/** The relations `ref` stores, as `kind shortId` (the CLI on the app's workspace). */
const relationsOf = async (running: RunningApp, ref: string): Promise<string[]> => {
  const got = await running.cli(["element", "get", ref]);
  const { relations } = (
    JSON.parse(got.stdout) as {
      element: { relations: { kind: string; direction: string; shortId?: string }[] };
    }
  ).element;
  return relations
    .filter((relation) => relation.direction === "out")
    .map((relation) => `${relation.kind} ${relation.shortId ?? ""}`);
};

test.describe("the context menu of the graph and the matrix", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("the sheet of an element's graph has Graph depth, Also show relation kind and Show only relation kind (SR-199 AK1, without the export of SR-151)", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    await rightClick(window.locator(".row").filter({ hasText: "Measure wind speed" }).first());
    await choose(window, "Show graph");
    const graph = window.locator(".graph");
    await expect(graph).toHaveAttribute("data-laid-out", /[1-9]/u);
    await rightClick(graph, await emptyPoint(graph));
    expect(await entryNames(window)).toEqual([
      "Graph depth",
      "Also show relation kind",
      "Show only relation kind",
      ALL,
    ]);
    // An entry runs as from the command prompt: "Graph depth" asks the depth.
    await choose(window, "Graph depth");
    await expect(label(window)).toHaveText("Graph depth");
    await window.keyboard.press("Escape");
  });

  test("the sheet of the metamodel's graph has Show metamodel as text (SR-199 AK2, without the export of SR-151)", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await fromCommandLine(window, "Show metamodel");
    const sheet = window.locator(".metamodel");
    await expect(sheet).toHaveAttribute("data-laid-out", /[1-9]/u);
    await rightClick(sheet, await emptyPoint(sheet));
    expect(await entryNames(window)).toEqual(["Show metamodel as text", ALL]);
    await window.keyboard.press("Escape");
    // A type box is no part of the sheet: the buffer's menu (SR-194 AK6).
    await rightClick(window.locator(".mm-type").first());
    expect((await entryNames(window))[0]).toBe("Go to element or buffer");
    await window.keyboard.press("Escape");
    await rightClick(sheet, await emptyPoint(sheet));
    await choose(window, "Show metamodel as text");
    await expect(window.locator(".metamodel-text")).toBeVisible();
  });

  test("[SR-199/AK3] Create relation in a cell of the matrix has the row and the column's kind and direction given, so only the other element is chosen", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await showMatrix(window);
    // An outgoing column: "Show a dial" derives from nothing yet.
    const cell = matrixRow(window, "SR-0000b4").locator("td.cell").nth(0);
    // Known once relation.options answered for the types of the rows.
    await expect(cell).toHaveAttribute("data-creatable", "");
    // Where the row's type cannot be the source (a need derives from nothing) or the target (a decision is
    // derived by nothing) of the column's kind, there is no "Create relation".
    for (const [id, column] of [
      ["N-0000a1", 0],
      ["D-0000e1", 1],
    ] as const) {
      const refused = matrixRow(window, id).locator("td.cell").nth(column);
      await expect(refused).not.toHaveAttribute("data-creatable", "");
      await rightClick(refused, await besideTargets(refused));
      expect(await entryNames(window)).toEqual([ALL]);
      await window.keyboard.press("Escape");
    }
    await rightClick(cell, await besideTargets(cell));
    expect(await entryNames(window)).toEqual(["Create relation", ALL]);
    await choose(window, "Create relation");
    await expect(label(window)).toHaveText("Create relation SR-0000b4 Derives from · target:");
    await window.keyboard.type("See the wind");
    await expect(candidates(window).first().locator(".name")).toHaveText("N-0000a1 See the wind");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toBeVisible();
    expect(await relationsOf(running, "SR-0000b4")).toContain("derives-from N-0000a1");

    // An incoming column, beside the element already there: the row is the target, the source is asked.
    await showMatrix(window);
    const incoming = matrixRow(window, "N-0000a2").locator("td.cell").nth(1);
    await expect(incoming.locator(".target")).toHaveCount(1);
    await expect(incoming).toHaveAttribute("data-creatable", "");
    await rightClick(incoming, await besideTargets(incoming));
    await choose(window, "Create relation");
    await expect(label(window)).toHaveText("Create relation Derives from N-0000a2 · source:");
    await window.keyboard.type("Show a dial");
    await expect(candidates(window).first().locator(".name")).toHaveText("SR-0000b4 Show a dial");
    await window.keyboard.press("Enter");
    await expect(window.locator(".result")).toBeVisible();
    expect(await relationsOf(running, "SR-0000b4")).toEqual(
      expect.arrayContaining(["derives-from N-0000a1", "derives-from N-0000a2"]),
    );
  });

  test("[SR-199/AK4] Remove relation on a connected element of the matrix removes the relation between the row and it, after the element's entries", async () => {
    running = await launchApp(FIXTURE);
    let window = running.window;
    await showMatrix(window);
    // An outgoing relation: "Measure wind speed" derives from "See the wind".
    const target = matrixRow(window, "SR-0000b1").locator("td.cell").nth(0).locator(".target");
    await expect(target).toContainText("N-0000a1");
    await rightClick(target);
    expect(await entryNames(window)).toEqual(ENTRY_THEN_REMOVE);
    expect(await relationsOf(running, "SR-0000b1")).toContain("derives-from N-0000a1");
    await choose(window, "Remove relation");
    await expect(window.locator(".result")).toBeVisible();
    expect(await relationsOf(running, "SR-0000b1")).not.toContain("derives-from N-0000a1");
    // The other relations of the row stay, and the same kind between other elements too.
    expect(await relationsOf(running, "SR-0000b1")).toContain("based-on D-0000e1");
    expect(await relationsOf(running, "SR-0000b2")).toContain("derives-from N-0000a1");
    await running.close();

    // An incoming relation: "Send data to the cloud" derives from "Warn of storms"; its file changes. It
    // has two more relations here, one of the same kind, which stay.
    running = await launchApp({ ...FIXTURE, files: { "requirements/SR-0000000000b5.md": WITH_MORE } });
    window = running.window;
    expect(await relationsOf(running, "SR-0000b5")).toEqual([
      "derives-from N-0000a2",
      "derives-from N-0000a1",
      "based-on D-0000e1",
    ]);
    await showMatrix(window);
    const incoming = matrixRow(window, "N-0000a2").locator("td.cell").nth(1).locator(".target");
    await expect(incoming).toContainText("SR-0000b5");
    await rightClick(incoming);
    expect(await entryNames(window)).toEqual(ENTRY_THEN_REMOVE);
    await choose(window, "Remove relation");
    await expect(window.locator(".result")).toBeVisible();
    expect(await relationsOf(running, "SR-0000b5")).toEqual(["derives-from N-0000a1", "based-on D-0000e1"]);
  });

  test("the menu of a matrix cell in light, as a screenshot", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await showMatrix(window);
    await rightClick(matrixRow(window, "SR-0000b1").locator("td.cell").nth(0).locator(".target"));
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-matrix-light.png") });
  });
});
