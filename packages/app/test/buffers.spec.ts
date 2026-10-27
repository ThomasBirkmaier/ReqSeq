// Alt+N and Alt+P (Option+N and Option+P on macOS) switch buffers (SR-115 AK5) on the built app: the next
// and the previous buffer in the order of opening, wrapping, also while typing in the text editor, and as
// the commands "Next buffer" and "Previous buffer". Alt is pressed by its physical key (`Alt+KeyN`); a
// real macOS dead key cannot be typed here, so one test sends the keydown macOS sends for Option+N.
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
    await expect(modeline(window)).toContainText("modified");
    // The switch leaves the focus on the shown buffer; Enter finds the editor once the element is loaded.
    await expect(shownBuffer(window)).toBeFocused();
    await expect(window.locator(".cm-line")).toHaveText([LINE, " ENDE"]);
    // Again from inside the editor, the other way.
    await window.keyboard.press("Enter");
    await expect(window.locator(".cm-content")).toBeFocused();
    await window.keyboard.press("Alt+KeyP");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", "All elements");
    await window.keyboard.press("Alt+KeyN");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", name ?? "");
    // The text is what was typed (Enter put the cursor after the last line break), without an "n", a "p"
    // or anything else; nothing was saved.
    await expect(window.locator(".cm-line")).toHaveText([LINE, " ENDE"]);
    expect(await savedText(running)).toBe(`${LINE}\n`);
  });

  test("[SR-115/AK5] Option+N as macOS sends it (a dead key, the physical key N) is taken in the editor and leaves it", async () => {
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
