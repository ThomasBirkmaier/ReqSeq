// Light and dark (SR-113, ThomasBirkmaier/ReqSeq-archive#409) on the built app: it follows the system, and the action "Toggle dark mode"
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
/** Whether the page hears the system as dark (the media query the theme follows). */
const systemDark = (window: Page): Promise<boolean> =>
  window.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);

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
  test(`[SR-113/AK-jp1f] the app starts ${scheme} as the system says`, async () => {
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

test("[SR-113/AK-jp1f] without a choice the app follows a change of the system setting", async () => {
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

test("[SR-113/AK-szv3] the command switches light and dark without a restart", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: "light" });
  const { window } = running;
  try {
    await listAll(window);
    await opened(window, DEMO_TITLE);
    // The editor has the focus, and a marker on the page that no restart or reload keeps (with the same
    // process id, it proves that the switch needs neither). Typed text would not: the prompt of the command
    // saves it first (SR-105), so a reload would show it too.
    await window.locator(".cm-content").click();
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

    await runCommand(window, "toggle dark");
    await expect(window.getByLabel("Minibuffer")).toContainText("Light mode until the app quits");
    expect(await sheet(window)).toBe(LIGHT.sheet);
    await expect(window.locator(".cm-content")).toHaveCSS("color", LIGHT.text);

    // After a choice the system's scheme is offered again; the emulated system here is light.
    await runCommand(window, "toggle dark");
    await expect.poll(() => sheet(window)).toBe(DARK.sheet);
    await runCommand(window, "follow system");
    await expect(window.getByLabel("Minibuffer")).toContainText("Light or dark as the system says");
    expect(await sheet(window)).toBe(LIGHT.sheet);
    expect(await chosen(window)).toBeUndefined();
  } finally {
    await running.close();
  }
});

test("[SR-113/AK-m9n1] a scheme chosen by command stays when the system changes, until Follow system light or dark mode; after a restart the app follows the system again", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: null });
  const { window } = running;
  try {
    await listAll(window);
    await running.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "light";
    });
    await expect.poll(() => sheet(window)).toBe(LIGHT.sheet);
    await runCommand(window, "toggle dark");
    await expect(window.getByLabel("Minibuffer")).toContainText("Dark mode until the app quits");
    expect(await sheet(window)).toBe(DARK.sheet);
    // The system turns dark: the chosen scheme stays, also when the system turns light again.
    await running.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await expect.poll(() => systemDark(window)).toBe(true);
    expect(await sheet(window)).toBe(DARK.sheet);
    await running.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "light";
    });
    await expect.poll(() => systemDark(window)).toBe(false);
    expect(await sheet(window)).toBe(DARK.sheet);
    expect(await chosen(window)).toBe("dark");
    // Following the system again: light now, and dark as soon as the system is.
    await runCommand(window, "follow system");
    await expect(window.getByLabel("Minibuffer")).toContainText("Light or dark as the system says");
    expect(await sheet(window)).toBe(LIGHT.sheet);
    await running.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await expect.poll(() => sheet(window)).toBe(DARK.sheet);
  } finally {
    await running.close({ keep: true });
  }
  // A choice that differs from the system, then a restart on the same user data: the system decides again.
  const { kept } = running;
  const chose = await launchApp(undefined, { kept, colorScheme: "light" });
  try {
    await listAll(chose.window);
    await runCommand(chose.window, "toggle dark");
    await expect.poll(() => sheet(chose.window)).toBe(DARK.sheet);
  } finally {
    await chose.close({ keep: true });
  }
  const again = await launchApp(undefined, { kept, colorScheme: "light" });
  try {
    await listAll(again.window);
    expect(await sheet(again.window)).toBe(LIGHT.sheet);
    expect(await chosen(again.window)).toBeUndefined();
  } finally {
    await again.close();
  }
});
