// Ctrl+N and Ctrl+P in the lists of the main window (SR-122 AK4, AK5) on the built app: the overview,
// the list of elements, the search result, the matrix, the elements of a package page and the
// neighbourhood. A fresh list has no row selected: Ctrl+N (or Down) selects the first row, and Ctrl+P
// stays "Go to" until a row is selected. The keys are the physical Ctrl key on every platform, so the
// tests press Control, not ControlOrMeta; Meta stands for Cmd on macOS.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree, types, statuses and the package Sensors (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

/** The label of the open prompt of the minibuffer. */
const promptLabel = (window: Page): Locator => window.getByLabel("Minibuffer").locator("label");

/** The selected rows of the shown buffer: none, or exactly one. */
const selectedRow = (window: Page): Locator => window.locator('[data-buffer] [aria-selected="true"]');

/** Opens the package Sensors: Ctrl/Cmd+P, its title, and Enter once the hit is there. */
const openPackage = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("Sensors");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Sensors");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText("Sensors");
  await expect(window.locator(".members .row").first()).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

test.describe("Ctrl+N and Ctrl+P in the lists of the main window", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-122/AK4] Ctrl+N and Ctrl+P walk the overview, the list, the search result and the matrix like Down and Up; Ctrl+N first selects the first row", async () => {
    const { window } = running;
    // The overview after the start: no line is selected.
    await expect(selectedRow(window)).toHaveCount(0);
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "overview-0");
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "overview-1");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "overview-0");
    await window.keyboard.press("ArrowDown");
    await expect(selectedRow(window)).toHaveAttribute("id", "overview-1");
    // The list of all elements.
    await listAll(window);
    const list = window.getByRole("listbox");
    await expect(selectedRow(window)).toHaveCount(0);
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-0");
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-1");
    await expect(list).toHaveAttribute("aria-activedescendant", "row-1");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-0");
    await expect(list).toHaveAttribute("aria-activedescendant", "row-0");
    // The search result.
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Search: wind");
    await expect(window.locator(".row").nth(1)).toBeVisible();
    await expect(selectedRow(window)).toHaveCount(0);
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-0");
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-1");
    // The matrix of the list of all elements.
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator("tbody tr").first()).toBeVisible();
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "matrix-row-1");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "matrix-row-0");
    await expect(promptLabel(window)).toHaveCount(0);
  });

  test("[SR-122/AK4] on a package page Ctrl+N selects the first element of the package, then walks its list; Ctrl+P on the first goes back to the page", async () => {
    const { window } = running;
    await openPackage(window);
    const listed = await running.cli([
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { package: "PKG-0000d1" } }, sort: DEFAULT_SORT }),
    ]);
    const titles = (JSON.parse(listed.stdout) as { elements: { title: string }[] }).elements.map(
      (element) => element.title,
    );
    expect(titles.length).toBeGreaterThanOrEqual(2);
    const members = window.locator(".members .list");
    const selected = members.locator('[aria-selected="true"] .title');
    await window.keyboard.press("Control+N");
    await expect(members).toBeFocused();
    await expect(selected).toHaveText(titles[0] ?? "");
    await window.keyboard.press("Control+N");
    await expect(selected).toHaveText(titles[1] ?? "");
    await window.keyboard.press("Control+P");
    await expect(selected).toHaveText(titles[0] ?? "");
    await window.keyboard.press("Control+P");
    await expect(window.locator("article")).toBeFocused();
    await expect(promptLabel(window)).toHaveCount(0);
  });

  test("[SR-122/AK5] with a row selected Ctrl+P only moves the selection, also on the first row; Cmd does not move it", async () => {
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-2");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-1");
    await expect(promptLabel(window)).toHaveCount(0);
    await window.keyboard.press("Control+P");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-0");
    await expect(promptLabel(window)).toHaveCount(0);
    // Cmd+N and Cmd+P are not Ctrl: they do not move the selection, and Cmd+P is "Go to".
    await window.keyboard.press("Meta+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "row-0");
    await window.keyboard.press("Meta+P");
    await expect(promptLabel(window)).toHaveText("Go to");
    await window.keyboard.press("Escape");
    // The same on the overview once a line is selected.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show overview");
    await window.keyboard.press("Enter");
    await expect(window.locator(".overview")).toBeFocused();
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "overview-0");
    await expect(promptLabel(window)).toHaveCount(0);
  });

  test('[SR-122/AK5] with no row selected Ctrl+P is still "Go to": after the start, and on a package page outside its list', async () => {
    const { window } = running;
    await window.keyboard.press("Control+P");
    await expect(promptLabel(window)).toHaveText("Go to");
    await window.keyboard.press("Escape");
    await openPackage(window);
    await window.keyboard.press("Control+P");
    await expect(promptLabel(window)).toHaveText("Go to");
    await window.keyboard.press("Escape");
  });
});

/** Requirements with children and incoming links of several kinds (fixtures/README.md). */
const NEIGHBOURHOOD = { fixture: "SR-107/neighbourhood" };

test.describe("Ctrl+N and Ctrl+P in the neighbourhood", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(NEIGHBOURHOOD);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-122/AK4] in the neighbourhood Ctrl+N and Ctrl+P move through the tree and the incoming links", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+P");
    // Show wind speed has a child and incoming links ("← excludes", "← inline reference").
    await window.keyboard.type("SR-b0000000001");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Show wind speed");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Show wind speed");
    await window.keyboard.press("ControlOrMeta+J");
    await expect(window.locator(".neighbourhood")).toBeFocused();
    const tree = window.locator('[role="tree"] [role="treeitem"]');
    await expect(tree.first()).toBeVisible();
    await expect(window.locator("h2")).toHaveText(["Children", "← excludes", "← inline reference"]);
    const treeRows = await tree.count();
    await expect(selectedRow(window)).toHaveCount(0);
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "nrow-0");
    await window.keyboard.press("Control+N");
    await expect(selectedRow(window)).toHaveAttribute("id", "nrow-1");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "nrow-0");
    await window.keyboard.press("Control+P");
    await expect(selectedRow(window)).toHaveAttribute("id", "nrow-0");
    // After the last row of the tree, Ctrl+N reaches the first incoming link.
    for (let step = 1; step <= treeRows; step += 1) {
      await window.keyboard.press("Control+N");
    }
    await expect(selectedRow(window)).toHaveAttribute("id", `nrow-${String(treeRows)}`);
    await expect(selectedRow(window)).not.toHaveRole("treeitem");
    await expect(promptLabel(window)).toHaveCount(0);
  });
});
