// The context menu (D-075, SR-194) on the built app: a right-click in a buffer opens the app's own menu at
// the pointer, with the commands fixed for that place under the names and keys of the command prompt
// (AK1); an entry runs as the same command from the command line (AK2); "All commands…" opens the command
// prompt (AK3); Escape and a left click outside close it, a right-click elsewhere moves it (AK4); a row, a
// hit, a node or a cell is selected before the menu opens (AK5); a place without its own choice gets the
// buffer's commands (AK6); on macOS Ctrl+click is a right-click (AK7). Right-clicks go through Chromium's
// input (Playwright's mouse), so the `contextmenu` is the one a person's click gives.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { goTo, launchApp, listAll, shownLayer } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entries = (window: Page): Locator => menu(window).getByRole("menuitem");
const entryNames = (window: Page): Promise<string[]> => entries(window).locator(".name").allTextContents();
const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const echo = (window: Page): Locator => window.locator(".minibuffer .echo");
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"]');

const BUFFER_ENTRIES = ["Go to element or buffer", "Search elements", "Close buffer"];
const ALL = "All commands…";

/** Right-clicks `target` at its point `at` (its middle when absent) and waits for the menu. */
const rightClick = async (target: Locator, at?: { x: number; y: number }): Promise<void> => {
  await target.click({ button: "right", ...(at === undefined ? {} : { position: at }) });
  await expect(menu(target.page())).toBeVisible();
};

/** Where `locator` is on the page; it must be visible. */
const boxOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("not visible");
  }
  return box;
};

/** The keys the entries of the open menu show, "" for none. */
const entryHints = (window: Page): Promise<string[]> =>
  entries(window).evaluateAll((items) => items.map((item) => item.querySelector(".hint")?.textContent ?? ""));

/** The key the command prompt shows for `name`, "" for none. */
const promptHint = async (window: Page, name: string): Promise<string> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(name);
  await expect(candidates(window).first().locator(".name")).toHaveText(name);
  const hint = await candidates(window).first().locator(".hint").allTextContents();
  await window.keyboard.press("Escape");
  return hint.join("");
};

/** Clicks the entry `name` of the open menu with the left button. */
const choose = async (window: Page, name: string): Promise<void> => {
  await entries(window).filter({ hasText: name }).click();
  await expect(menu(window)).toBeHidden();
};

/** Runs `name` from the command prompt, as a person does: Ctrl/Cmd+Shift+P, the name, Enter. */
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

/** What the window shows: the areas with their buffers, the modeline and the minibuffer's line. */
const shown = async (window: Page): Promise<Record<string, unknown>> => ({
  areas: await window.locator("[data-area]").evaluateAll((areas) =>
    areas.map((area) => ({
      side: area.getAttribute("data-area"),
      active: area.hasAttribute("data-active"),
      heading:
        area.querySelector("h1")?.textContent ??
        area.querySelector("[aria-label]")?.getAttribute("aria-label"),
    })),
  ),
  modeline: await modeline(window).textContent(),
  echo: await echo(window).textContent(),
});

/** What the window shows once it has stopped changing (counts load after the buffer): the result to compare with. */
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

/**
 * Whether the element marked `data-test-target` is selected (`aria-selected`, or the matrix's `current`)
 * at the moment the menu is added to the page, before any later render (AK5).
 */
const watchSelection = (window: Page): Promise<void> =>
  window.evaluate(() => {
    const state = window as unknown as { selectedAtMenu?: boolean | undefined };
    state.selectedAtMenu = undefined;
    const observer = new MutationObserver(() => {
      if (document.querySelector(".context-menu") !== null) {
        const target = document.querySelector("[data-test-target]");
        state.selectedAtMenu =
          target?.getAttribute("aria-selected") === "true" || target?.classList.contains("current") === true;
        target?.removeAttribute("data-test-target");
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

/** Right-clicks `target` and says whether it was selected when the menu appeared. */
const selectedWhenMenuOpens = async (target: Locator, at?: { x: number; y: number }): Promise<boolean> => {
  const window = target.page();
  await target.evaluate((element) => {
    element.setAttribute("data-test-target", "");
  });
  await watchSelection(window);
  await rightClick(target, at);
  return window.evaluate(() => (window as unknown as { selectedAtMenu?: boolean }).selectedAtMenu === true);
};

test.describe("the context menu", () => {
  let running: RunningApp;

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-194/AK-dhq2] a right-click opens the app's menu at the pointer, with the names and keys of the command prompt", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const list = shownLayer(window, "left").locator(".buffer");
    const box = await boxOf(list);
    // Below the rows, on the empty sheet, with room for the menu below.
    const at = { x: 40, y: box.height - 300 };
    await rightClick(list, at);
    const placed = await boxOf(menu(window));
    expect(placed.x).toBeCloseTo(box.x + at.x + 2, 0);
    expect(placed.y).toBeCloseTo(box.y + at.y + 2, 0);
    // Each entry as the command prompt lists it: the name and its key.
    const names = await entryNames(window);
    expect(names).toEqual([...BUFFER_ENTRIES, "Split window", ALL]);
    const hints = await entryHints(window);
    await window.keyboard.press("Escape");
    for (const [index, name] of names.slice(0, -1).entries()) {
      expect(hints[index], name).toBe(await promptHint(window, name));
    }
    // "All commands…" shows the key of the command prompt.
    expect(hints.at(-1)).toBe(process.platform === "darwin" ? "⌘⇧P" : "Ctrl+Shift+P");
    // At the right edge the menu opens left of the pointer, inside the window.
    await rightClick(list, { x: box.width - 10, y: 40 });
    const flipped = await boxOf(menu(window));
    expect(flipped.x + flipped.width).toBeLessThanOrEqual(box.x + box.width - 10);
    expect(flipped.x).toBeGreaterThanOrEqual(0);
    // One menu, the app's.
    await expect(menu(window)).toHaveCount(1);
  });

  test("[SR-194/AK-kg56] an entry gives what the same command from the command line gives", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const sheet = (side: string): Locator => shownLayer(window, side).locator(".buffer").first();
    const empty = async (side: string): Promise<{ x: number; y: number }> => {
      const box = await sheet(side).boundingBox();
      return { x: 20, y: (box?.height ?? 100) - 20 };
    };
    // Split window, from the command line and from the menu.
    await fromCommandLine(window, "Split window");
    await expect(window.locator("[data-area]")).toHaveCount(2);
    const split = await settled(window);
    await fromCommandLine(window, "Unsplit window");
    await expect(window.locator("[data-area]")).toHaveCount(1);
    await rightClick(sheet("left"), await empty("left"));
    await choose(window, "Split window");
    await expect(window.locator("[data-area]")).toHaveCount(2);
    await expect.poll(() => shown(window)).toEqual(split);
    await fromCommandLine(window, "Unsplit window");

    // Close buffer with unsaved input: it is saved first, then the buffer goes, both ways.
    const typed = async (word: string): Promise<void> => {
      await openElement(window, "See the wind");
      await shownLayer(window).locator(".cm-content").first().click();
      await window.keyboard.press("ControlOrMeta+End");
      await window.keyboard.type(` ${word}`);
    };
    await typed("first");
    await fromCommandLine(window, "Close buffer");
    await expect(shownLayer(window).locator("article h1")).toHaveCount(0);
    const closed = await settled(window);
    await typed("second");
    // On no field of the element (the title has its own menu, SR-196).
    await rightClick(sheet("left"), await empty("left"));
    await choose(window, "Close buffer");
    await expect(shownLayer(window).locator("article h1")).toHaveCount(0);
    await expect.poll(() => shown(window)).toEqual(closed);
    const file = await running.cli(["element", "get", "N-0000a1"]);
    expect((JSON.parse(file.stdout) as { element: { text: string } }).element.text).toMatch(/first\s+second/);

    // In a split window, a right-click in the inactive area acts there, as a click and the command line do.
    await openElement(window, "See the wind");
    await fromCommandLine(window, "Split window");
    await expect(window.locator("[data-area]")).toHaveCount(2);
    const inactive = (await window.locator("[data-area]:not([data-active])").getAttribute("data-area")) ?? "";
    await window.locator(`[data-area="${inactive}"]`).click({ position: { x: 20, y: 20 } });
    await fromCommandLine(window, "Close buffer");
    const byLine = await settled(window);
    if ((await window.locator("[data-area]").count()) === 2) {
      await fromCommandLine(window, "Unsplit window");
    }
    // The same again, from the menu.
    await openElement(window, "See the wind");
    await fromCommandLine(window, "Split window");
    await expect(window.locator("[data-area]")).toHaveCount(2);
    await rightClick(window.locator(`[data-area="${inactive}"]`), { x: 20, y: 20 });
    await choose(window, "Close buffer");
    await expect.poll(() => shown(window)).toEqual(byLine);
  });

  test("[SR-194/AK-h8zf] All commands… opens the command prompt with every command of the place by name", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const row = shownLayer(window).locator(".row").nth(2);
    await rightClick(row);
    await expect(row).toHaveAttribute("aria-selected", "true");
    await choose(window, ALL);
    await expect(window.locator("label.prompt-label")).toHaveText("All commands");
    await expect(window.locator(".prompt-input")).toHaveValue("");
    const fromMenu = await candidates(window).locator(".name").allTextContents();
    expect(fromMenu).toEqual([...fromMenu].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    await window.keyboard.press("Escape");
    // The same list as "All commands…" of the command prompt on this place (SR-133 AK3).
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(window.locator(".prompt-input")).toHaveValue("");
    await candidates(window).filter({ hasText: ALL }).click();
    await expect(window.locator("label.prompt-label")).toHaveText("All commands");
    expect(await candidates(window).locator(".name").allTextContents()).toEqual(fromMenu);
    expect(fromMenu.length).toBeGreaterThan(10);
  });

  test("[SR-194/AK-kvdd] Escape and a left click outside close the menu; a right-click elsewhere opens the menu there", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const before = await settled(window);
    const list = shownLayer(window, "left").locator(".buffer");
    const box = await list.boundingBox();
    const empty = { x: 30, y: (box?.height ?? 100) - 30 };
    await rightClick(list, empty);
    await window.keyboard.press("Escape");
    await expect(menu(window)).toBeHidden();
    await expect.poll(() => shown(window)).toEqual(before);
    // A right-click elsewhere: one menu, at the new place.
    await rightClick(list, empty);
    const first = await menu(window).boundingBox();
    await rightClick(list, { x: empty.x + 400, y: empty.y });
    await expect(menu(window)).toHaveCount(1);
    const second = await menu(window).boundingBox();
    expect(second?.x).not.toBe(first?.x);
    // A left click outside closes it and does what it does without the menu: the row opens.
    const row = shownLayer(window).locator(".row").nth(1);
    const title = (await row.locator(".title").textContent()) ?? "";
    await row.click();
    await expect(menu(window)).toBeHidden();
    await expect(shownLayer(window).locator("article h1").first()).toHaveText(title);
    // A left click into the inactive area of a split window closes it and makes that area active.
    await fromCommandLine(window, "Split window");
    await expect(window.locator("[data-area]")).toHaveCount(2);
    const active = (await window.locator("[data-area][data-active]").getAttribute("data-area")) ?? "";
    const other = active === "left" ? "right" : "left";
    await rightClick(window.locator(`[data-area="${active}"]`), { x: 20, y: 20 });
    await window.locator(`[data-area="${other}"]`).click({ position: { x: 20, y: 20 } });
    await expect(menu(window)).toBeHidden();
    await expect(window.locator(`[data-area="${other}"]`)).toHaveAttribute("data-active", "");
  });

  test("[SR-194/AK-j5rp] a list row, a search hit and a package entry are selected before the menu opens, and its commands act on them", async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    expect(await selectedWhenMenuOpens(shownLayer(window).locator(".row").nth(3))).toBe(true);
    await window.keyboard.press("Escape");
    // A search hit.
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".row").nth(1)).toBeVisible();
    expect(await selectedWhenMenuOpens(shownLayer(window).locator(".row").nth(1))).toBe(true);
    await window.keyboard.press("Escape");
    // A package entry; "Open to the right" opens it beside the page.
    await openElement(window, "Sensors");
    const entry = shownLayer(window).locator(".members .row").nth(1);
    const title = (await entry.locator(".title").textContent()) ?? "";
    expect(await selectedWhenMenuOpens(entry)).toBe(true);
    await choose(window, ALL);
    await window.keyboard.type("Open to the right");
    await expect(candidates(window).first().locator(".name")).toHaveText("Open to the right");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window, "right").locator("article h1")).toHaveText(title);
  });

  test("[SR-194/AK-j5rp] a node of the graph and of the metamodel is selected before the menu opens", async () => {
    running = await launchApp({ fixture: "SR-111/graph" });
    const { window } = running;
    await listAll(window);
    await shownLayer(window).locator(".row").first().click();
    await expect(shownLayer(window).locator("article h1").first()).toBeVisible();
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(shownLayer(window).locator(".graph")).toBeFocused();
    const node = shownLayer(window).locator('.graph-node:not([aria-selected="true"])').first();
    const title = (await node.locator(".graph-title").textContent()) ?? "";
    expect(await selectedWhenMenuOpens(node)).toBe(true);
    await choose(window, ALL);
    await window.keyboard.type("Open to the right");
    await expect(candidates(window).first().locator(".name")).toHaveText("Open to the right");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window, "right").locator("article h1")).toHaveText(title);
    await fromCommandLine(window, "Unsplit window");
    // The metamodel.
    await fromCommandLine(window, "Show metamodel");
    const type = shownLayer(window).locator('.mm-type:not([aria-selected="true"])').first();
    await expect(type).toBeVisible();
    expect(await selectedWhenMenuOpens(type)).toBe(true);
  });

  test("[SR-194/AK-j5rp] a target and a cell of the matrix are selected before the menu opens", async () => {
    running = await launchApp({ fixture: "SR-125/matrix" });
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+T");
    const target = shownLayer(window).locator(".matrix td.cell .target").first();
    await expect(target).toBeVisible();
    const name = (await target.textContent()) ?? "";
    expect(await selectedWhenMenuOpens(target)).toBe(true);
    await choose(window, ALL);
    await window.keyboard.type("Open to the right");
    await expect(candidates(window).first().locator(".name")).toHaveText("Open to the right");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window, "right").locator("article h1")).toBeVisible();
    expect(name).toContain((await shownLayer(window, "right").locator("article h1").textContent()) ?? "-");
    await fromCommandLine(window, "Unsplit window");
    // A cell, pressed beside its relations: the cell is selected, in its row.
    const cell = shownLayer(window).locator(".matrix td.cell").nth(1);
    const box = await cell.boundingBox();
    expect(await selectedWhenMenuOpens(cell, { x: (box?.width ?? 10) - 3, y: (box?.height ?? 10) - 3 })).toBe(
      true,
    );
  });

  test("[SR-194/AK-r0g6] a place without its own choice gets the buffer's commands", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await listAll(window);
    const list = shownLayer(window, "left").locator(".buffer");
    const box = await list.boundingBox();
    await rightClick(list, { x: 30, y: (box?.height ?? 100) - 30 });
    expect(await entryNames(window)).toEqual([...BUFFER_ENTRIES, "Split window", ALL]);
    await choose(window, "Split window");
    await rightClick(window.locator("[data-area][data-active]"), { x: 20, y: 20 });
    expect(await entryNames(window)).toEqual([...BUFFER_ENTRIES, "Other pane", "Unsplit window", ALL]);
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-split-light.png") });
  });

  test("[SR-194/AK-hkgb] on macOS Ctrl+click is a right-click", async () => {
    test.skip(process.platform !== "darwin", "Ctrl+click is a right-click on macOS only");
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    const row = shownLayer(window).locator(".row").nth(2);
    await row.click({ modifiers: ["Control"] });
    await expect(menu(window)).toHaveCount(1);
    await expect(row).toHaveAttribute("aria-selected", "true");
    // The row did not open.
    await expect(shownLayer(window).locator("article h1")).toHaveCount(0);
  });

  test("Ctrl+click on Linux and Windows opens no menu", async () => {
    test.skip(process.platform === "darwin", "on macOS Ctrl+click is a right-click");
    running = await launchApp(FIXTURE);
    const { window } = running;
    await listAll(window);
    await shownLayer(window)
      .locator(".row")
      .nth(2)
      .click({ modifiers: ["Control"] });
    await expect(shownLayer(window).locator("article h1").first()).toBeVisible();
    await expect(menu(window)).toHaveCount(0);
  });

  test("the menu in light, as a screenshot", async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    const { window } = running;
    await listAll(window);
    const row = shownLayer(window).locator(".row").nth(2);
    await rightClick(row);
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-light.png") });
  });
});
