// The Markdown editor of the element buffer (SR-065, #77) on the built app: live preview, saving, and
// what is in the file afterwards. Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import {
  DEMO_FILE,
  DEMO_FILES,
  DEMO_FRONT_MATTER,
  DEMO_ID,
  DEMO_TITLE,
  REFERENCE_FILES,
  REFERENCE_LABEL,
  REFERENCE_SOURCE_ID,
  REFERENCE_SOURCE_TITLE,
  REFERENCE_TARGET_TITLE,
} from "./support/demo.js";

/** 14 elements with a derivation tree (fixtures/README.md), plus the demo element. */
const FIXTURE = { fixture: "SR-069/filter", files: { ...DEMO_FILES, ...REFERENCE_FILES } };

const opened = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".cm-content")).toBeVisible();
  // The buffer has the focus once the prompt is gone; its keys (Enter) work from then on.
  await expect(window.locator("article")).toBeFocused();
};

const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

/** The text of the editor as it is shown. */
const shown = (window: Page): Promise<string> => window.locator(".cm-content").innerText();

/** The message after a save: "Saved <ID> <title>". */
const SAVED = new RegExp(`^Saved .*${DEMO_TITLE}$`);

const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const minibuffer = (window: Page): Locator => window.getByLabel("Minibuffer");

test.describe("the Markdown editor in the element buffer", () => {
  let running: RunningApp;
  const consoleProblems: string[] = [];
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    running.window.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) {
        consoleProblems.push(message.text());
      }
    });
    await listAll(running.window);
  });
  test.afterEach(async () => {
    expect(consoleProblems).toEqual([]);
    await running.close();
  });

  test("[SR-065/AK1] the editor shows headings, emphasis, lists, tables and code blocks set, and the source only on the cursor line", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    const content = window.locator(".cm-content");
    // Not focused: every construct is set, none of its Markdown characters is visible.
    await expect(content.locator(".cm-lr-h1")).toHaveCount(1);
    await expect(content.locator(".cm-lr-h2")).toHaveCount(1);
    await expect(content.locator(".cm-lr-strong").first()).toHaveText("sofort");
    await expect(content.locator(".cm-lr-em").first()).toHaveText("geschrieben");
    await expect(content.locator(".cm-lr-strike")).toHaveText("Durchgestrichenes");
    await expect(content.locator(".cm-lr-code").first()).toHaveText("Code");
    await expect(content.locator(".cm-lr-bullet")).toHaveCount(2);
    await expect(content.locator(".cm-lr-task")).toHaveText(["☐", "☑"]);
    await expect(content.locator(".cm-lr-quote")).toHaveCount(1);
    await expect(content.locator(".cm-lr-link")).toHaveText("das Beispiel");
    await expect(content.locator(".cm-lr-codeblock")).toHaveCount(3);
    await expect(content.locator("table.cm-lr-table")).toHaveCount(1);
    await expect(content.locator("table.cm-lr-table th")).toHaveText(["Größe", "Wert", "Einheit"]);
    await expect(content.locator("table.cm-lr-table td .cm-lr-strong")).toHaveText("25");
    const unfocused = await shown(window);
    for (const markup of ["**", "~~", "```", "# ", "| :", "](", "> "]) {
      expect([markup, unfocused.includes(markup)]).toEqual([markup, false]);
    }
    // Click in the line with the strong text: that line shows its source, the others stay set.
    await content.locator(".cm-lr-strong").first().click();
    const line = content.locator(".cm-line", { has: window.locator(".cm-lr-strong") });
    await expect(line).toContainText("**sofort**");
    await expect(line).toContainText("~~Durchgestrichenes~~");
    await expect(content.locator(".cm-lr-h1")).not.toContainText("#");
    await expect(content.locator("table.cm-lr-table")).toHaveCount(1);
    // The cursor goes into the table: its source is shown, the table widget is gone.
    await content.locator("table.cm-lr-table td").first().click();
    await expect(content.locator("table.cm-lr-table")).toHaveCount(0);
    await expect(content).toContainText("| :--- | ---: | :---: |");
    await expect(content.locator(".cm-lr-table-source")).toHaveCount(4);
    // Down out of the table: it is set again.
    for (let step = 0; step < 6; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(content.locator("table.cm-lr-table")).toHaveCount(1);
    expect(await shown(window)).not.toContain("| :--- |");
  });

  test("Escape right after typing leaves the text, also before the slash menu's source has answered (#574)", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    // Every typed letter asks the slash menu's source; its Escape must not take an Escape that comes before
    // the answer when no `/` was typed. Before #574 about one round in ten kept the focus in the editor.
    for (let round = 0; round < 30; round += 1) {
      await window.keyboard.press("Enter");
      await expect(window.locator(".cm-content")).toBeFocused();
      await window.keyboard.insertText(` r${String(round)}`);
      await window.keyboard.press("Escape");
      await expect(window.locator("article")).toBeFocused();
    }
  });

  test("Escape leaves the text: the buffer has the focus and no source line is shown; Enter edits again", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    await window.locator(".cm-lr-strong").first().click();
    await expect(window.locator(".cm-content")).toContainText("**sofort**");
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
    await expect(window.locator(".cm-content")).not.toContainText("**");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    // The cursor is at the end of the text: what is typed comes after the last line.
    await window.keyboard.insertText("ENDE");
    await expect(window.locator(".cm-line").last()).toHaveText("ENDE");
  });

  test("[SR-065/AK2] a text typed in the app is saved with Ctrl/Cmd+S and the file is CommonMark with GitHub extensions", async () => {
    const { window, workspace } = running;
    await opened(window, DEMO_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+a");
    await window.keyboard.insertText(
      "# Heading one\n\nPlain *em* and **strong** and ~~strike~~ and `code`.\n\n- a",
    );
    // The second item comes from Enter, which continues the list.
    await window.keyboard.press("Enter");
    await window.keyboard.insertText("b\n\n1. one\n2. two\n\n- [ ] open\n- [x] done\n\n");
    await window.keyboard.insertText("| A | B |\n| :-- | --: |\n| 1 | 2 |\n\n```ts\ncode\n```\n\n> quote");
    await expect(modeline(window)).toContainText("modified");
    await window.keyboard.press("ControlOrMeta+s");
    await expect(minibuffer(window)).toContainText(SAVED);
    await expect(modeline(window)).not.toContainText("modified");
    const body = [
      "# Heading one",
      "",
      "Plain *em* and **strong** and ~~strike~~ and `code`.",
      "",
      "- a",
      "- b",
      "",
      "1. one",
      "2. two",
      "",
      "- [ ] open",
      "- [x] done",
      "",
      "| A | B |",
      "| :-- | --: |",
      "| 1 | 2 |",
      "",
      "```ts",
      "code",
      "```",
      "",
      "> quote",
      "",
    ].join("\n");
    const file = await fs.readFile(
      path.join((workspace as { root: string }).root, ...DEMO_FILE.split("/")),
      "utf8",
    );
    expect(file).toBe(`${DEMO_FRONT_MATTER}${body}`);
    const html = micromark(body, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
    for (const expected of [
      "<h1>Heading one</h1>",
      "<em>em</em>",
      "<strong>strong</strong>",
      "<del>strike</del>",
      "<code>code</code>",
      "<ul>",
      "<ol>",
      '<input type="checkbox" disabled="" />',
      "<table>",
      '<th align="left">A</th>',
      '<th align="right">B</th>',
      '<pre><code class="language-ts">',
      "<blockquote>",
    ]) {
      expect(html).toContain(expected);
    }
    // Another access gives the same text (SR-080).
    const got = await running.cli(["element", "get", DEMO_ID]);
    expect((JSON.parse(got.stdout) as { element: { text: string } }).element.text).toBe(body);
    // The editor still shows the text; saving did not rebuild it.
    await expect(window.locator(".cm-content")).toContainText("Heading one");
  });

  test("Ctrl/Cmd+Z undoes one step and Ctrl/Cmd+Shift+Z redoes it; the Undo item of the Edit menu also goes back one step", async () => {
    const { window, app } = running;
    await opened(window, DEMO_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.insertText("AAA ");
    // Typing within half a second is one step; later typing is the next one.
    await window.waitForTimeout(700);
    await window.keyboard.insertText("BBB ");
    await window.waitForTimeout(700);
    await window.keyboard.insertText("CCC ");
    await window.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => shown(window)).not.toContain("CCC ");
    expect(await shown(window)).toContain("BBB ");
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await expect.poll(() => shown(window)).toContain("CCC ");
    await window.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => shown(window)).not.toContain("CCC ");
    // The Undo item of the menu (the native role) goes back one step as well, not two. The key itself
    // never reaches it: CodeMirror handles Ctrl/Cmd+Z; the real keyboard is checked by hand
    // (verification/SR-065.md).
    const found = await app.evaluate(({ app: electronApp, BrowserWindow, Menu }, mac) => {
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.role === "undo") {
            return item;
          }
          const inner = item.submenu ? find(item.submenu.items) : undefined;
          if (inner !== undefined) {
            return inner;
          }
        }
        return undefined;
      };
      const window = BrowserWindow.getAllWindows()[0];
      const item = find(Menu.getApplicationMenu()?.items ?? []);
      if (item === undefined || window === undefined) {
        return false;
      }
      if (mac) {
        // On macOS Electron leaves the editing roles to Cocoa: `click()` of such an item does nothing, and
        // the menu sends the role's action (`undo:`) to the first responder, the page of the focused window.
        // This does what a click on Edit > Undo does there (#505).
        electronApp.focus({ steal: true });
        window.focus();
        window.webContents.focus();
        Menu.sendActionToFirstResponder("undo:");
      } else {
        // Electron types `click` as `Function`; it takes the event, the window and its page.
        const click = item.click as (
          event: undefined,
          focused: Electron.BrowserWindow,
          contents: Electron.WebContents,
        ) => void;
        click.call(item, undefined, window, window.webContents);
      }
      return true;
    }, process.platform === "darwin");
    expect(found).toBe(true);
    await expect.poll(() => shown(window)).not.toContain("BBB ");
    expect(await shown(window)).toContain("AAA ");
  });

  test("[SR-105/AK1] a typed text is saved when another buffer is shown, and Close buffer closes without asking", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.insertText(" ENDE");
    await expect(modeline(window)).toContainText("modified");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toContainText(" ENDE");
    await expect(modeline(window)).not.toContainText("modified");
    await runCommand(window, "close buffer");
    await expect(window.getByRole("listbox")).toBeVisible();
    await expect(minibuffer(window)).not.toContainText("unsaved");
    // Opened again, the element shows what was saved.
    await opened(window, DEMO_TITLE);
    expect(await shown(window)).toContain("ENDE");
    await expect(modeline(window)).not.toContainText("modified");
  });

  test("saving without a change says so; Save element is in the command prompt with its key", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    await window.keyboard.press("ControlOrMeta+s");
    await expect(minibuffer(window)).toContainText("No changes to save");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("save elem");
    const first = window.locator('.candidates [role="option"]').first();
    await expect(first).toContainText("Save element");
    await expect(first.locator(".hint")).toHaveText(/^(Ctrl\+S|⌘S)$/);
    await window.keyboard.press("Escape");
  });

  test("[SR-110/AK2] an outdated inline reference and an outdated relation show the date of the version they store, as element get with hintDates gives it", async () => {
    const { window } = running;
    /** The `relation.outdated` hints of `ref` as the CLI dates them (`hintDates`). */
    const datedHints = async (ref: string): Promise<{ message: string; storedDate?: string | null }[]> => {
      const got = await running.cli(["element", "get", "--input", JSON.stringify({ ref, hintDates: true })]);
      expect(got.code, got.stderr).toBe(0);
      const output = JSON.parse(got.stdout) as {
        element: { problems?: { code: string; message: string; storedDate?: string | null }[] };
      };
      return (output.element.problems ?? []).filter((problem) => problem.code === "relation.outdated");
    };
    /** The word after an outdated reference: the day of the stored version (D-013), or "unknown date". */
    const word = (hint: { storedDate?: string | null }): string =>
      `link outdated · version of ${hint.storedDate === undefined || hint.storedDate === null ? "unknown date" : hint.storedDate.slice(0, 10)}`;
    // An inline reference in the text.
    const [reference] = await datedHints(REFERENCE_SOURCE_ID);
    expect(reference?.message).toMatch(/: stored version from .+, current version from .+$/);
    await opened(window, REFERENCE_SOURCE_TITLE);
    await expect(window.locator(".cm-lr-outdated-word")).toHaveText(` ${word(reference ?? {})}`);
    await expect(window.locator(".cm-lr-outdated")).toHaveAttribute("title", reference?.message ?? "");
    // A relation of the element: its row is marked with the same word (#665), the dated hint on hover.
    const [relation] = await datedHints("SR-0000b4");
    // Not `opened`: this element has a Markdown box besides the text.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Show a dial");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Show a dial");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Show a dial");
    const mark = window.locator("article .relation .outdated");
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveText(` ${word(relation ?? {})}`);
    await expect(mark).toHaveAttribute("title", relation?.message ?? "");
  });

  test("an inline reference reads as its label, is marked outdated and opens its element on a click and with Ctrl/Cmd+Enter", async () => {
    const { window } = running;
    await opened(window, REFERENCE_SOURCE_TITLE);
    expect(await shown(window)).toContain(`Siehe ${REFERENCE_LABEL}`);
    expect(await shown(window)).not.toContain("reqseq:");
    expect(await shown(window)).not.toContain("n1:");
    await expect(window.locator(".cm-lr-outdated")).toBeVisible();
    await expect(window.locator(".cm-lr-outdated-word")).toHaveText(/^ link outdated/);
    // A click on the label opens the element it refers to.
    await window.locator(".cm-lr-ref").click();
    await expect(window.locator("article h1")).toHaveText(REFERENCE_TARGET_TITLE);
    // Back to the text; the cursor inside the label, Ctrl/Cmd+Enter follows the reference as well.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(REFERENCE_SOURCE_TITLE);
    await expect(window.locator("article")).toBeFocused();
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Home");
    for (let step = 0; step < 8; step += 1) {
      await window.keyboard.press("ArrowRight");
    }
    await window.keyboard.press("ControlOrMeta+Enter");
    await expect(window.locator("article h1")).toHaveText(REFERENCE_TARGET_TITLE);
  });

  test("the editor makes no request outside the app's own protocols", async () => {
    const { window } = running;
    await opened(window, DEMO_TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.insertText("See [a](https://example.org) <https://example.org/b> ![i](x.png)");
    await window.keyboard.press("ControlOrMeta+s");
    await expect(minibuffer(window)).toContainText("Saved");
    expect(running.stderr()).not.toContain("Blocked a request");
  });
});
