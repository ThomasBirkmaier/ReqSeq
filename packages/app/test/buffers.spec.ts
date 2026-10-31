// Working in buffers on the built app (SR-115): Ctrl/Cmd+P chooses any buffer and any element with a
// fuzzy text, the one used last first (AK1); there is no tab bar, however many buffers are open (AK2).
// Alt+N and Alt+P (Option+N and Option+P on macOS) switch buffers (SR-115 AK5): the next
// and the previous buffer in the order of opening, wrapping, also while typing in the text editor, and as
// the commands "Next buffer" and "Previous buffer". Alt is pressed by its physical key (`Alt+KeyN`); a
// real macOS dead key cannot be typed here, so one test sends the keydown macOS sends for Option+N.
// After the app is closed and started again, the buffers open before are back behind the overview
// (SR-115 AK4). "Split window" shows two buffers side by side, an element and its graph (SR-115 AK3).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

/** The element whose text is one plain line and a line break, so the editor shows it as typed. */
const ELEMENT = "See the wind";
const ELEMENT_ID = "N-0000a1";
const LINE = "N1: parent of SR-0000b1 and SR-0000b2.";

/** The shown buffer: its name is its label. */
const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');

const modeline = (window: Page): Locator => window.getByLabel("Modeline");

/** Opens `title` with Ctrl/Cmd+P; the buffer has the focus afterwards. */
const goTo = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator("article")).toBeFocused();
};

/** Searches `text` with Ctrl/Cmd+Shift+F. */
const search = async (window: Page, text: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+F");
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
  await expect(shownBuffer(window)).toHaveAttribute("aria-label", `Search: ${text}`);
};

/** The text of the element in its file, read with the CLI. */
const savedText = async (running: RunningApp): Promise<string> => {
  const got = await running.cli(["element", "get", ELEMENT_ID]);
  return (JSON.parse(got.stdout) as { element: { text: string } }).element.text;
};

test.describe("Alt+N and Alt+P switch buffers", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-115/AK5] Alt+N shows the next buffer in the order of opening and wraps; Alt+P the previous", async () => {
    const { window } = running;
    // Opened in this order: the overview (at the start), the list, an element, a search.
    await listAll(window);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toBeVisible();
    const element = await window.locator("article").getAttribute("aria-label");
    await search(window, "wind");
    // The element is used last: the order of use changes, the order of opening does not.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", element ?? "");
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Search: wind");
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Search: wind");
    // The shown buffer has the focus: its keys work at once.
    await expect(shownBuffer(window)).toBeFocused();
  });

  test("[SR-115/AK5] Alt+N and Alt+P while typing in the editor switch buffers and insert no character", async () => {
    const { window } = running;
    await listAll(window);
    await goTo(window, ELEMENT);
    const name = await shownBuffer(window).getAttribute("aria-label");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.insertText(" ENDE");
    await expect(modeline(window)).toContainText("modified");
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await expect(shownBuffer(window)).toBeFocused();
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", name ?? "");
    // Leaving the element saved the input (SR-105 AK1); the file ends with a line break (ADR-0004).
    await expect(modeline(window)).not.toContainText("modified");
    // The switch leaves the focus on the shown buffer; Enter finds the editor once the element is loaded.
    await expect(shownBuffer(window)).toBeFocused();
    await expect(window.locator(".cm-line")).toHaveText([LINE, " ENDE", ""]);
    // Again from inside the editor, the other way.
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", name ?? "");
    // The text is what was typed (Enter put the cursor after the last line break), without an "n", a "p"
    // or anything else, and so is the file.
    await expect(window.locator(".cm-line")).toHaveText([LINE, " ENDE", ""]);
    expect((await savedText(running)).trimEnd()).toBe(`${LINE}\n ENDE`);
  });

  test("[SR-145/AK2] Option+N as macOS sends it (a dead key, the physical key N) is taken in the editor and leaves it", async () => {
    const { window } = running;
    await listAll(window);
    await goTo(window, ELEMENT);
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    // macOS: Option+N is the dead key of "~", Option+P is "π". Playwright cannot type a dead key, so
    // the page gets the keydown that macOS gives it.
    const option = (key: string, code: string): Promise<boolean> =>
      window.locator(".cm-content").evaluate(
        (content, init) => {
          const event = new KeyboardEvent("keydown", {
            ...init,
            altKey: true,
            bubbles: true,
            cancelable: true,
          });
          content.dispatchEvent(event);
          return event.defaultPrevented;
        },
        { key, code },
      );
    expect(await option("Dead", "KeyN")).toBe(true);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    await expect(window.locator(".cm-editor")).toHaveCount(0);
    await expect(shownBuffer(window)).toBeFocused();
    await window.keyboard.press("Alt+KeyP");
    // The switch leaves the focus on the shown buffer; Enter finds the editor once the element is loaded.
    await expect(shownBuffer(window)).toBeFocused();
    await expect(window.locator(".cm-line")).toHaveText([LINE, ""]);
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    expect(await option("π", "KeyP")).toBe(true);
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await window.keyboard.press("Alt+KeyN");
    await expect(window.locator(".cm-line")).toHaveText([LINE, ""]);
    await expect(modeline(window)).not.toContainText("modified");
  });

  test('[SR-115/AK5] "Next buffer" and "Previous buffer" are commands of the prompt, with their keys', async () => {
    const { window } = running;
    await listAll(window);
    await search(window, "wind");
    for (const [command, key, shown] of [
      ["Next buffer", "N", "Overview"],
      ["Previous buffer", "P", "Search: wind"],
    ] as const) {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await window.keyboard.type(command.toLowerCase());
      const first = window.locator('.candidates [role="option"]').first();
      await expect(first.locator(".name")).toHaveText(command);
      await expect(first.locator(".hint")).toHaveText(new RegExp(`^(Alt\\+${key}|⌥${key})$`));
      await window.keyboard.press("Enter");
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", shown);
    }
  });

  test("[SR-115/AK5] in an open prompt Alt+N switches no buffer", async () => {
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+P");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Go to");
    await window.keyboard.press("Alt+KeyN");
    await window.keyboard.press("Alt+KeyP");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Go to");
    await window.keyboard.press("Escape");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
  });
});

test.describe("Go to and no tab bar", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');

  test("[SR-115/AK1] Ctrl+P offers the open buffers, the one used last first, then the elements used before, and finds any element by a word of its title with a typo", async () => {
    const { window } = running;
    // Opened: the overview (at the start), the list, its first element, a second element by Ctrl+P.
    await listAll(window);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toBeVisible();
    const first = (await window.locator("article").getAttribute("aria-label")) ?? "";
    await goTo(window, "Warn of storms");
    // The second element is closed: no longer open, but used.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Close buffer");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", first);
    await search(window, "wind");
    await window.keyboard.press("ControlOrMeta+P");
    await expect(names(window)).toHaveText([first, "All elements", "Overview", "N-0000a2 Warn of storms"]);
    // A word of a title that is not open, with a typo: core's search finds it, as `element search` does.
    const typo = "icimg";
    const searched = await running.cli([
      "element",
      "search",
      "--input",
      JSON.stringify({ query: typo, fields: ["id", "title"], limit: 20 }),
    ]);
    const found = JSON.parse(searched.stdout) as { hits: { title: string }[] };
    expect(found.hits.map((hit) => hit.title)).toEqual(["Survive icing"]);
    await window.keyboard.type(typo);
    await expect(names(window)).toHaveText(["SR-0000b3 Survive icing"]);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Survive icing");
    // The element closed before is chosen like a buffer, by a fuzzy text (a slip).
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("wran of storms");
    await expect(names(window).first()).toHaveText("N-0000a2 Warn of storms");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Warn of storms");
  });

  test("[SR-115/AK2] with several buffers open the window has no tab bar", async () => {
    const { window } = running;
    // Open: the overview, the list, an element, its graph, a search.
    await listAll(window);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toBeVisible();
    const element = (await window.locator("article").getAttribute("aria-label")) ?? "";
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toBeFocused();
    await search(window, "wind");
    const noTabBar = async (hidden: readonly string[]): Promise<void> => {
      for (const role of ["tab", "tablist", "navigation"] as const) {
        expect([role, await window.getByRole(role).count()]).toEqual([role, 0]);
      }
      // The window has the sheet, the modeline and the minibuffer, nothing else (on macOS the top strip
      // that stands in for the title bar, #490); the sheet holds exactly one buffer.
      expect(
        await window
          .locator(".shell > *")
          .evaluateAll((all) => all.map((e) => e.getAttribute("aria-label") ?? e.getAttribute("class"))),
      ).toEqual([...(process.platform === "darwin" ? ["titlebar"] : []), "Sheet", "Modeline", "Minibuffer"]);
      await expect(window.locator('[aria-label="Sheet"] > *')).toHaveCount(1);
      // No name of a buffer that is not shown is visible.
      for (const name of hidden) {
        await expect(window.getByText(name, { exact: true })).toHaveCount(0);
      }
    };
    await noTabBar(["All elements", "Overview", `Graph: ${element}`]);
    // The same with the graph shown, and the names in the prompt only while it is asked.
    await window.keyboard.press("ControlOrMeta+P");
    await expect(names(window)).toHaveText([`Graph: ${element}`, element, "All elements", "Overview"]);
    await window.keyboard.type("graph");
    await window.keyboard.press("Enter");
    await expect(window.locator(".graph")).toBeFocused();
    await noTabBar(["All elements", "Overview", "Search: wind"]);
  });
});

/** Every file below `root` by its content hash. */
const snapshot = async (root: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
      } else {
        result[path.relative(root, file)] = createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex");
      }
    }
  };
  await walk(root);
  return result;
};

test.describe("the open buffers after a restart", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-115/AK4] after closing and starting the app again the buffers open before are back", async () => {
    running = await launchApp(FIXTURE);
    let { window } = running;
    const root = running.workspace?.root ?? "";
    const before = await snapshot(root);
    // Opened in this order: the overview (at the start), the list, an element, its graph, a search.
    await listAll(window);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toBeVisible();
    const element = (await window.locator("article").getAttribute("aria-label")) ?? "";
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toBeFocused();
    await search(window, "wind");
    // The list is used last.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("All elements");
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");

    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    // The overview shows first; the buffers are behind it, in their order of use.
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "Overview");
    // They come back once their elements are named, so the prompt is asked until they are there.
    const names = window.locator('.candidates [role="option"] .name');
    await expect
      .poll(
        async () => {
          await window.keyboard.press("ControlOrMeta+P");
          // Before they are back the prompt may have nothing to offer: no wait longer than a second then.
          await names
            .first()
            .waitFor({ timeout: 1000 })
            .catch(() => undefined);
          const offered = await names.allTextContents();
          await window.keyboard.press("Escape");
          return offered;
        },
        { timeout: 15_000 },
      )
      .toEqual(["All elements", "Search: wind", `Graph: ${element}`, element]);
    // Alt+N walks them in their order of opening.
    for (const name of ["All elements", element, `Graph: ${element}`, "Search: wind", "Overview"]) {
      await window.keyboard.press("Alt+KeyN");
      await expect(shownBuffer(window)).toHaveAttribute("aria-label", name);
    }
    // Each shows its content again.
    await window.keyboard.press("Alt+KeyN");
    await expect(window.locator(".row").first()).toBeVisible();
    await window.keyboard.press("Alt+KeyN");
    await expect(window.locator("article h1")).toBeVisible();
    // Nothing of it went into the workspace.
    expect(await snapshot(root)).toEqual(before);
  });
});

test.describe("Split window", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** Where `locator` is on the page; it must be visible. */
  const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
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

  test("[SR-115/AK3] Split window shows an element and its graph side by side", async () => {
    const { window } = running;
    await listAll(window);
    await goTo(window, ELEMENT);
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toBeFocused();
    await command(window, "Split window");
    // Two areas side by side: the graph where it was, the element beside it.
    const left = window.locator('[data-area="left"]');
    const right = window.locator('[data-area="right"]');
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    await expect(right.locator("article h1")).toHaveText(ELEMENT);
    await expect(left.locator(".graph-node.root")).toBeVisible();
    const [leftBox, rightBox] = [await box(left), await box(right)];
    expect(leftBox.y).toBe(rightBox.y);
    expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(rightBox.x);
    // The graph opens on its element again at the new width: the root stands in the middle third.
    const root = await box(left.locator(".graph-node.root"));
    const centre = root.x + root.width / 2;
    expect(centre).toBeGreaterThan(leftBox.x + leftBox.width / 3);
    expect(centre).toBeLessThan(leftBox.x + (leftBox.width * 2) / 3);
    await expect(modeline(window)).toContainText("Graph:");
    await expect(window.locator(".graph")).toBeFocused();
    // No tab bar while split (AK2).
    await expect(window.getByRole("tab")).toHaveCount(0);
    await expect(window.getByRole("tablist")).toHaveCount(0);
    await expect(window.getByRole("navigation")).toHaveCount(0);
    // Other window: the element is active; what is typed into it is saved.
    await command(window, "Other window");
    await expect(modeline(window)).not.toContainText("Graph:");
    await expect(modeline(window)).toContainText(ELEMENT_ID);
    await expect(right.locator("article")).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(right.locator(".cm-content")).toBeFocused();
    await window.keyboard.insertText(" SPLIT");
    await expect.poll(() => savedText(running)).toContain(" SPLIT");
    await expect(left.locator(".graph-node").first()).toBeVisible();
    // Back to the graph, then a click into the text of the element: it is active, the caret is where clicked.
    await command(window, "Other window");
    await expect(modeline(window)).toContainText("Graph:");
    await right
      .locator(".cm-line")
      .first()
      .click({ position: { x: 1, y: 5 } });
    await expect(modeline(window)).not.toContainText("Graph:");
    await expect(right.locator(".cm-content")).toBeFocused();
    await window.keyboard.insertText("Z");
    await expect.poll(() => savedText(running)).toMatch(/^ZN1: /u);
    // Unsplit: one area again.
    await command(window, "Unsplit window");
    await expect(window.locator('[aria-label="Sheet"] > *')).toHaveCount(1);
  });
});
