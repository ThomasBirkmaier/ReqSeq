// Light and dark (SR-113, #409) on the built app: it follows the system, and the action "Toggle dark mode"
// switches without a restart. The expected colours are the tokens of styles.css as the browser reports
// them (`rgb(...)`); styles.test.ts checks that the tokens exist and read well.
//
// What these tests prove about AK1: the start tests use Playwright's `colorScheme`, which emulates
// `prefers-color-scheme` in the renderer only (main's nativeTheme stays as the system has it), so they show
// that the page follows the media query; the test that sets nativeTheme.themeSource shows that the
// system's setting reaches the page. The real OS path is the manual demonstration in
// verification/SR-113.md.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILES, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

/** Sheet (--sheet) and text (--text) of each scheme, as the browser reports colours. */
const LIGHT = { sheet: "rgb(255, 255, 255)", text: "rgb(31, 35, 40)" };
const DARK = { sheet: "rgb(22, 24, 27)", text: "rgb(230, 232, 235)" };

/** The sheet is painted on the root element (styles.css), the text colour is inherited. */
const sheet = (window: Page): Promise<string> =>
  window.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
const textColour = (window: Page): Promise<string> =>
  window.evaluate(() => getComputedStyle(document.body).color);
const chosen = (window: Page): Promise<string | undefined> =>
  window.evaluate(() => document.documentElement.dataset["theme"]);

const opened = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".cm-content")).toBeVisible();
};

const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

for (const [scheme, colours] of [
  ["light", LIGHT],
  ["dark", DARK],
] as const) {
  test(`[SR-113/AK1] the app starts ${scheme} as the system says`, async () => {
    const running = await launchApp(FIXTURE, { colorScheme: scheme });
    const { window } = running;
    try {
      await listAll(window);
      expect(await sheet(window)).toBe(colours.sheet);
      expect(await textColour(window)).toBe(colours.text);
      expect(await chosen(window)).toBeUndefined();
      await opened(window, DEMO_TITLE);
      await expect(window.locator(".cm-content")).toHaveCSS("color", colours.text);
    } finally {
      await running.close();
    }
  });
}

test("[SR-113/AK1] without a choice the app follows a change of the system setting", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: null });
  const { window } = running;
  try {
    await listAll(window);
    await running.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await expect.poll(() => sheet(window)).toBe(DARK.sheet);
    await running.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "light";
    });
    await expect.poll(() => sheet(window)).toBe(LIGHT.sheet);
    expect(await chosen(window)).toBeUndefined();
  } finally {
    await running.close();
  }
});

test("[SR-113/AK2] the command switches light and dark without a restart", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: "light" });
  const { window } = running;
  try {
    await listAll(window);
    await opened(window, DEMO_TITLE);
    // Unsaved text, and a marker on the page: neither survives a restart or a reload.
    await window.locator(".cm-content").click();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.insertText("\n\nNoch nicht gespeichert.");
    await expect(window.getByLabel("Modeline")).toContainText("modified");
    await window.evaluate(() => {
      (window as unknown as { __noReload: number }).__noReload = 1;
    });
    const pid = await running.app.evaluate(() => process.pid);
    expect(await sheet(window)).toBe(LIGHT.sheet);

    // With the editor focused, Ctrl/Cmd+Shift+P reaches the window handler (CodeMirror does not bind it).
    await runCommand(window, "toggle dark");
    await expect(window.getByLabel("Minibuffer")).toContainText("Dark mode until the app quits");
    expect(await sheet(window)).toBe(DARK.sheet);
    await expect(window.locator(".cm-content")).toHaveCSS("color", DARK.text);
    expect(await chosen(window)).toBe("dark");
    expect(await running.app.evaluate(() => process.pid)).toBe(pid);
    expect(await window.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1);
    await expect(window.locator(".cm-content")).toContainText("Noch nicht gespeichert.");
    await expect(window.getByLabel("Modeline")).toContainText("modified");

    await runCommand(window, "toggle dark");
    await expect(window.getByLabel("Minibuffer")).toContainText("Light mode until the app quits");
    expect(await sheet(window)).toBe(LIGHT.sheet);
    await expect(window.locator(".cm-content")).toHaveCSS("color", LIGHT.text);

    // After a choice the system's scheme is offered again; the emulated system here is light.
    await runCommand(window, "toggle dark");
    expect(await sheet(window)).toBe(DARK.sheet);
    await runCommand(window, "follow system");
    await expect(window.getByLabel("Minibuffer")).toContainText("Light or dark as the system says");
    expect(await sheet(window)).toBe(LIGHT.sheet);
    expect(await chosen(window)).toBeUndefined();
  } finally {
    await running.close();
  }
});
