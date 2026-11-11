// The context menu on a field of an element (SR-196) on the built app: "Copy field" first on the title, the
// short ID, a property box and a group of relations, not in the text (AK1); "Add property" and "Clear
// property" on a box, and "List elements with this value" on a box whose value lists elements (AK2); "Set
// status" on the status (AK3) and "Show element ID and version" on the short ID (AK4), both in the
// modeline. Right-clicks go through Chromium's input (Playwright's mouse), and the clipboard is the
// system's, read in main.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

const ID = "69069069-0000-4000-8000-00000000f196";
const FILE = "requirements/SR-00000000f196.md";
const TITLE = "Measure the gusts";

const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    [FILE]: [
      "---",
      `id: ${ID}`,
      "type: system-requirement",
      "status: draft",
      `title: ${TITLE}`,
      "rationale: Gusts break the mast.",
      "requirement-type: functional",
      "acceptance-criteria:",
      "  - Given a gust, when it is checked, then it holds.",
      "topic: Timing",
      "derives-from:",
      "  - { id: 69069069-0000-4000-8000-0000000000a1, version: n1:1111111111111111 }",
      "---",
      "",
      "Gusts are measured.",
      "",
    ].join("\n"),
  },
};

const ALL = "All commands…";

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entries = (window: Page): Locator => menu(window).getByRole("menuitem");
const entryNames = (window: Page): Promise<string[]> => entries(window).locator(".name").allTextContents();
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"]');
const field = (window: Page, label: string): Locator => window.locator(`article [data-field="${label}"]`);
const modelineField = (window: Page, label: string): Locator =>
  window.locator(`.modeline [data-field="${label}"]`);
const promptLabel = (window: Page): Locator => window.getByLabel("Minibuffer").locator("label");

/** Right-clicks `target` and waits for the menu. */
const rightClick = async (window: Page, target: Locator): Promise<void> => {
  await target.click({ button: "right" });
  await expect(menu(window)).toBeVisible();
};

/** Clicks the entry `name` of the open menu with the left button. */
const choose = async (window: Page, name: string): Promise<void> => {
  await entries(window)
    .filter({ hasText: new RegExp(`^${name}`) })
    .first()
    .click();
  await expect(menu(window)).toBeHidden();
};

test.describe("the context menu on a field", () => {
  let running: RunningApp;
  let clipboard: string;

  const file = (): string => path.join(running.workspace?.root ?? "", ...FILE.split("/"));
  const read = (): Promise<string> => fs.readFile(file(), "utf8");
  const readClipboard = (): Promise<string> => running.app.evaluate(({ clipboard }) => clipboard.readText());
  const writeClipboard = (text: string): Promise<void> =>
    running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);

  test.beforeEach(async () => {
    const light = test.info().title.includes("screenshot");
    running = await launchApp(FIXTURE, light ? { colorScheme: "light" } : {});
    clipboard = await readClipboard();
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(TITLE);
    await expect(candidates(window).first()).toContainText(TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1").first()).toHaveText(TITLE);
    await expect(modelineField(window, "Status")).toHaveText("draft");
  });

  test.afterEach(async () => {
    try {
      await writeClipboard(clipboard);
    } finally {
      await running.close();
    }
  });

  test("[SR-196/AK1] Copy field is the first entry on the title, the short ID, a box and a group of relations, and copies that field", async () => {
    const { window } = running;
    const id = (await modelineField(window, "ID").textContent()) ?? "";
    const cases: readonly (readonly [Locator, string])[] = [
      [window.locator("article h1").first(), TITLE],
      [modelineField(window, "ID"), id],
      [field(window, "topic").locator(".value"), "Timing"],
      [
        field(window, "derives-from").locator("h2"),
        (await field(window, "derives-from").locator('[role="link"]').textContent()) ?? "",
      ],
    ];
    for (const [target, value] of cases) {
      await writeClipboard("");
      await rightClick(window, target);
      expect((await entryNames(window))[0]).toBe("Copy field");
      await choose(window, "Copy field");
      await expect.poll(readClipboard).toBe(value);
    }
    expect(id).not.toBe("");
    // The text has its own menu (SR-195), without Copy field.
    await rightClick(window, field(window, "Text").locator(".cm-content"));
    expect(await entryNames(window)).not.toContain("Copy field");
  });

  test("[SR-196/AK2] a property box adds Add and Clear property, and List elements with this value where its value lists elements", async () => {
    const { window } = running;
    await rightClick(window, field(window, "topic").locator(".value"));
    expect(await entryNames(window)).toEqual([
      "Copy field",
      "Add property",
      "Clear property",
      "List elements with this value",
      ALL,
    ]);
    await window.keyboard.press("Escape");
    // Long free text lists no elements (SR-132 AK4).
    await rightClick(window, field(window, "rationale").locator(".value"));
    expect(await entryNames(window)).toEqual(["Copy field", "Add property", "Clear property", ALL]);
    await choose(window, "Clear property");
    await window.keyboard.press("ControlOrMeta+s");
    await expect.poll(read).not.toContain("rationale:");
    // Add property asks which one, as from the command line.
    await rightClick(window, field(window, "topic").locator(".value"));
    await choose(window, "Add property");
    await expect(promptLabel(window)).toHaveText("Add property");
    await window.keyboard.press("Escape");
    // The list of the value pressed.
    await rightClick(window, field(window, "topic").locator(".value"));
    await choose(window, "List elements with this value");
    await expect(window.getByLabel("Modeline")).toContainText("topic: Timing");
    await expect(window.locator(".row .title", { hasText: TITLE })).toHaveCount(1);
  });

  test("[SR-196/AK3] the status has Set status, which sets it as from the command line", async () => {
    const { window } = running;
    await rightClick(window, modelineField(window, "Status"));
    expect(await entryNames(window)).toEqual(["Copy field", "Set status", ALL]);
    await choose(window, "Set status");
    // The shown element is the default of refs, as in the command line (SR-108 AK4).
    await expect(promptLabel(window)).toHaveText("Set status · refs:");
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText(/^Set status \S+ · refs:$/);
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText(/^Set status \S+ · status:$/);
    await window.keyboard.type("Approved");
    await expect(candidates(window).first().locator(".name")).toHaveText("Approved");
    await window.keyboard.press("Enter");
    await expect.poll(read).toContain("status: approved");
  });

  test("[SR-196/AK3] Copy field on the status copies it; the status has no copy symbol", async () => {
    const { window } = running;
    await writeClipboard("");
    await rightClick(window, modelineField(window, "Status"));
    await choose(window, "Copy field");
    await expect.poll(readClipboard).toBe("draft");
    // The ID beside it has one (SR-128); the status has none.
    await expect(modelineField(window, "ID").locator(".copy")).toHaveCount(1);
    await expect(modelineField(window, "Status").locator(".copy")).toHaveCount(0);
    await expect(window.locator(".modeline .copy")).toHaveCount(1);
  });

  test("[SR-196/AK4] the short ID has Show element ID and version, which says them", async () => {
    const { window } = running;
    await rightClick(window, modelineField(window, "ID"));
    expect(await entryNames(window)).toEqual(["Copy field", "Show element ID and version", ALL]);
    await choose(window, "Show element ID and version");
    await expect(window.getByLabel("Minibuffer")).toContainText(ID);
    // The focus is back in the buffer, where the keys act again.
    await expect(window.locator("article")).toBeFocused();
    await rightClick(window, modelineField(window, "ID"));
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
  });

  test("[SR-196/AK4] a right-click on the type or any other place of the modeline opens no menu", async () => {
    const { window } = running;
    /** Right-clicks the middle of the first text of the modeline that is `text`. */
    const rightClickText = async (text: string): Promise<void> => {
      const point = await window.locator(".modeline").evaluate((modeline, wanted) => {
        const walker = document.createTreeWalker(modeline, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(wanted) ?? -1;
          if (at >= 0) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + wanted.length);
            const box = range.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          }
        }
        return undefined;
      }, text);
      expect(point, text).toBeDefined();
      await window.mouse.click(point?.x ?? 0, point?.y ?? 0, { button: "right" });
    };
    // The first part is "ID · type · status" (SR-114 AK1).
    const head = (await window.locator(".modeline .parts > .segment").first().textContent()) ?? "";
    const type = head.split(" · ")[1] ?? "";
    expect(type).not.toBe("");
    // Counts the `contextmenu` events that reach the window, so the test knows each right-click arrived.
    await window.evaluate(() => {
      const seen = { count: 0 };
      Object.assign(globalThis, { reqseqContextMenus: seen });
      globalThis.addEventListener(
        "contextmenu",
        () => {
          seen.count += 1;
        },
        { capture: true },
      );
    });
    const arrived = (): Promise<number> =>
      window.evaluate(
        () => (globalThis as { reqseqContextMenus?: { count: number } }).reqseqContextMenus?.count ?? 0,
      );
    /** Two frames: what the app renders for an event is painted by then. */
    const painted = (): Promise<void> =>
      window.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          }),
      );
    for (const [at, text] of [type, "Weather station"].entries()) {
      await rightClickText(text);
      await expect.poll(arrived).toBe(at + 1);
      await painted();
      await expect(menu(window), text).toHaveCount(0);
    }
    // The short ID next to the type still has its menu.
    await rightClick(window, modelineField(window, "ID"));
    await window.keyboard.press("Escape");
  });

  test("the menu on a property box in light, as a screenshot", async () => {
    const { window } = running;
    await rightClick(window, field(window, "topic").locator(".value"));
    const folder = process.env["REQSEQ_SCREENSHOTS"] ?? path.join("test-results", "electron", "screenshots");
    await window.screenshot({ path: path.join(folder, "context-menu-fields-light.png") });
  });
});
