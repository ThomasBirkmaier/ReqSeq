// The main view (SR-100, #112): one buffer (list, search result or element), the modeline and the
// minibuffer, on the built app. What the app shows is compared with what the CLI gives for the same
// workspace (SR-080). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree, types, statuses and an obsolete requirement (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

interface Listed {
  readonly elements: readonly { readonly title: string; readonly shortId: string }[];
  readonly total: number;
  readonly tree?: readonly { readonly depth: number }[];
}

const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect([argv.join(" "), result.code]).toEqual([argv.join(" "), 0]);
  return JSON.parse(result.stdout) as T;
};

const rowTitles = (window: Page): Promise<string[]> => window.locator(".row .title").allTextContents();

/** Opens the command prompt, types `command` and runs the first candidate. */
const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

test.describe("the main view on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-100/AK1] the main view shows only the list, the element and the search line", async () => {
    const { window } = running;
    // Nothing that can be operated, besides the buffer itself and the minibuffer, is permanently visible.
    // The text of an element is edited in place (SR-065): its editor, `article .cm-content`, is the one
    // text box of the sheet and is not an extra control; a list has none.
    const permanent = async (editors: number): Promise<void> => {
      for (const role of [
        "button",
        "tab",
        "tablist",
        "navigation",
        "complementary",
        "dialog",
        "form",
        "menu",
        "menubar",
        "toolbar",
        "tree",
        "combobox",
        "searchbox",
      ] as const) {
        expect([role, await window.getByRole(role).count()]).toEqual([role, 0]);
      }
      expect(
        await window
          .getByRole("textbox")
          .evaluateAll((all) => all.filter((e) => !e.matches("article .cm-content")).length),
      ).toBe(0);
      expect(await window.getByRole("textbox").count()).toBe(editors);
      // The only buttons are the copy symbols of the fields (SR-128), and they are seen only while a field
      // is hovered or has the focus: none is visible here.
      expect(
        await window.locator("button:not(.copy), input, textarea, select, form, nav, aside, dialog").count(),
      ).toBe(0);
      await expect(window.locator(".copy:visible")).toHaveCount(0);
      // The window has the sheet, the modeline and the minibuffer, nothing else.
      expect(
        await window.locator(".shell > *").evaluateAll((all) => all.map((e) => e.getAttribute("aria-label"))),
      ).toEqual(["Sheet", "Modeline", "Minibuffer"]);
      // The sheet holds exactly one buffer.
      expect(await window.locator('[aria-label="Sheet"] > *').count()).toBe(1);
    };
    // With the list open ...
    await expect(window.getByRole("listbox")).toBeVisible();
    await permanent(0);
    // ... and with an element open.
    await window.keyboard.press("Enter");
    await expect(window.locator("article")).toBeVisible();
    await permanent(1);
    // The prompt, which is the search line, is there only while it is asked for.
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await expect(window.getByRole("combobox")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByRole("combobox")).toHaveCount(0);
    await permanent(1);
  });

  test("the list shows what `element list` gives for the default sort (type, then ID): titles in order and the total in the modeline", async () => {
    const listed = await cliJson<Listed>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ sort: DEFAULT_SORT }),
    ]);
    expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
    await expect(running.window.getByLabel("Modeline")).toContainText(`${String(listed.total)} elements`);
    await expect(running.window.getByLabel("Modeline")).toContainText("All elements");
    // The default says nothing in the modeline, and it is not the order of the store.
    await expect(running.window.getByLabel("Modeline")).not.toContainText("sorted");
    const stored = await cliJson<Listed>(running, ["element", "list"]);
    expect(stored.total).toBe(listed.total);
    expect(stored.elements.map((e) => e.title)).not.toEqual(listed.elements.map((e) => e.title));
  });

  test('"Workspace order" shows the order of the store that `element list` gives without a sort, and says so', async () => {
    await runCommand(running.window, "sort list");
    await running.window.keyboard.type("workspace order");
    await running.window.keyboard.press("Enter");
    await expect(running.window.getByLabel("Modeline")).toContainText("All elements · workspace order");
    const stored = await cliJson<Listed>(running, ["element", "list"]);
    await expect(running.window.locator(".row .title")).toHaveText(stored.elements.map((e) => e.title));
    // And back: "Type and ID" is the default again, which says nothing.
    await runCommand(running.window, "sort list");
    await running.window.keyboard.type("type and id");
    await running.window.keyboard.press("Enter");
    const listed = await cliJson<Listed>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ sort: DEFAULT_SORT }),
    ]);
    await expect(running.window.getByLabel("Modeline")).not.toContainText("workspace order");
    await expect(running.window.locator(".row .title")).toHaveText(listed.elements.map((e) => e.title));
  });

  test("sorted by hierarchy it shows the derivation tree with the depths that `tree` gives", async () => {
    await runCommand(running.window, "sort list");
    await expect(running.window.getByLabel("Minibuffer").locator("label")).toHaveText("Sort by");
    await running.window.keyboard.type("hierarchy");
    await running.window.keyboard.press("Enter");
    const listed = await cliJson<Listed>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ sort: [{ by: "hierarchy" }] }),
    ]);
    await expect(running.window.getByLabel("Modeline")).toContainText("All elements · tree");
    expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
    const indents = await running.window
      .locator(".row .title")
      .evaluateAll((all) => all.map((e) => (e as HTMLElement).style.paddingLeft));
    expect(indents).toEqual((listed.tree ?? []).map((t) => `${String(t.depth * 1.25)}rem`));
    expect(Math.max(...(listed.tree ?? []).map((t) => t.depth))).toBeGreaterThan(0);
  });

  test("filtering by type through the command prompt gives the list of the CLI for the same condition", async () => {
    await runCommand(running.window, "filter list by type");
    await expect(running.window.getByLabel("Minibuffer").locator("label")).toHaveText("Type");
    await running.window.keyboard.type("need");
    await running.window.keyboard.press("Enter");
    const listed = await cliJson<Listed>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { type: ["need"] } }, sort: DEFAULT_SORT }),
    ]);
    await expect(running.window.getByLabel("Modeline")).toContainText("type: need");
    await expect(running.window.getByLabel("Modeline")).toContainText(`${String(listed.total)} elements`);
    expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
    expect(listed.total).toBeLessThan(14);
  });

  test("the command prompt finds an action by an abbreviation with a typo, and shows its shortcut and what matched", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("srch elem");
    const options = window.locator('.candidates [role="option"]');
    await expect(options.first()).toContainText("Search elements");
    const first = await options.allTextContents();
    expect(first.slice(0, 3).some((text) => text.startsWith("Search elements"))).toBe(true);
    await expect(options.first().locator(".hint")).toHaveText(/^(Ctrl\+Shift\+F|⌘⇧F)$/);
    expect(await options.first().locator("mark").allTextContents()).toEqual(["S", "rch", "elem"]);
    await window.keyboard.press("Escape");
    await expect(window.getByRole("combobox")).toHaveCount(0);
  });

  test("Ctrl+P finds an element by a word of its title and opens it, with what `element get` gives", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("icing");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Survive icing");
    await window.keyboard.press("Enter");
    const got = await cliJson<{
      element: { title: string; shortId: string; type: string; status: string; text?: string };
    }>(running, ["element", "get", "SR-0000b3"]);
    await expect(window.locator("article h1")).toHaveText(got.element.title);
    // The modeline names the ID, the type by its name in the metamodel and the status (SR-114 AK1).
    const types = await cliJson<{ types: { key: string; name: string }[] }>(running, ["metamodel", "get"]);
    const typeName = types.types.find((type) => type.key === got.element.type)?.name;
    expect(typeName).toBeDefined();
    await expect(window.getByLabel("Modeline")).toContainText(
      `${got.element.shortId} · ${typeName ?? ""} · ${got.element.status}`,
    );
    if (got.element.text !== undefined) {
      await expect(window.locator("article .cm-content")).toHaveText(got.element.text.trim());
    }
    // The text editor is the only thing in the element that takes input.
    await expect(window.locator("article input, article textarea")).toHaveCount(0);
    await expect(window.locator("article [contenteditable]")).toHaveCount(1);
    await expect(window.locator("article [contenteditable]")).toHaveClass(/cm-content/);
    // Ctrl+P, Enter goes back to the list.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "All elements");
    await expect(window.locator('[aria-selected="true"]')).toBeVisible();
  });

  test("[SR-122/AK1] Ctrl+N and Ctrl+P move through the command prompt and the go-to prompt", async () => {
    const { window } = running;
    const selected = window.locator('.candidates [role="option"][aria-selected="true"]');
    await window.keyboard.press("ControlOrMeta+Shift+P");
    const first = await selected.textContent();
    await window.keyboard.press("Control+N");
    await expect(selected).not.toHaveText(first ?? "");
    await window.keyboard.press("Control+N");
    const third = await selected.textContent();
    await window.keyboard.press("Control+P");
    await expect(selected).not.toHaveText(third ?? "");
    await window.keyboard.press("Control+P");
    await expect(selected).toHaveText(first ?? "");
    // Ctrl+P in the prompt moves up; it does not turn the command prompt into "Go to".
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Command");
    await window.keyboard.press("Escape");
    // The go-to prompt: hits of element.search, moved with Ctrl+N and Ctrl+P.
    await window.keyboard.press("Control+P");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Go to");
    await window.keyboard.type("wind");
    const options = window.locator('.candidates [role="option"]');
    await expect(options.nth(1)).toBeVisible();
    await expect(selected).toHaveText(await options.first().innerText());
    await window.keyboard.press("Control+N");
    await expect(selected).toHaveText(await options.nth(1).innerText());
    await window.keyboard.press("Control+P");
    await expect(selected).toHaveText(await options.first().innerText());
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Go to");
    await window.keyboard.press("Escape");
  });

  test("[SR-123/AK2] [SR-123/AK3] cab runs Close all buffers; it asks in the minibuffer, and Enter keeps the buffer with unsaved text", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeVisible();
    await expect(window.locator("article")).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.insertText(" ENDE");
    await expect(window.getByLabel("Modeline")).toContainText("modified");
    await window.keyboard.press("Escape");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await runCommand(window, "cab");
    await expect(window.getByLabel("Minibuffer").locator("label")).toContainText("with unsaved changes");
    await expect(window.getByRole("dialog")).toHaveCount(0);
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer")).toContainText("Closed 1 buffer");
    await expect(window.getByLabel("Modeline")).toContainText("modified");
    await runCommand(window, "close all buffers");
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Enter");
    // Every buffer is closed; the overview is what remains (SR-118), and the unsaved text is gone.
    await expect(window.locator("[data-buffer]")).toHaveCount(1);
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Overview");
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
  });

  test("a relation of an element opens the element it points to", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Survive icing");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Survive icing");
    await window.keyboard.press("Enter");
    const link = window.getByRole("link").first();
    const target = (await link.textContent()) ?? "";
    await link.click();
    await expect(window.locator("article h1")).toBeVisible();
    expect(target).not.toBe("");
    await expect(window.getByLabel("Modeline")).not.toContainText("SR-0000b3");
  });

  test("the search buffer shows the hits of `element search` in the same order", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    const searched = await cliJson<{ hits: { title: string }[]; total: number }>(running, [
      "element",
      "search",
      "--input",
      JSON.stringify({ query: "wind" }),
    ]);
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Search: wind");
    expect(await rowTitles(window)).toEqual(searched.hits.map((h) => h.title));
    await expect(window.getByLabel("Modeline")).toContainText(`${String(searched.total)} hits`);
    expect(await window.locator(".row mark").count()).toBeGreaterThan(0);
  });

  test("Show element ID and version says the UUID and the date of the version, not the check value (D-013)", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await runCommand(window, "show element id");
    const echo = window.getByLabel("Minibuffer");
    await expect(echo).toContainText("69069069-0000-4000-8000-");
    await expect(echo).toContainText("version of");
    await expect(echo).not.toContainText("n1:");
  });

  test("the app makes no request outside its own protocols while it is used (SR-078)", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("wind");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toBeVisible();
    expect(running.stderr()).not.toContain("Blocked a request");
  });
});
