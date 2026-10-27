// The look of the window (#490) on the built app, in light and in dark: the command prompt's candidates
// are a card lifted off the sheet, the modeline is one rounded bar of separate segments, and on macOS a
// strip of the sheet in its colours moves the window and names it. The native title bar style itself
// (`hiddenInset`) is the main process's window option (shell.test.ts); Linux and Windows keep the native
// frame, so the strip is checked here with the renderer told it runs on macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp, listAll, modifier } from "./support/app.js";
import { DEMO_FILES, DEMO_TITLE } from "./support/demo.js";

const FIXTURE = { fixture: "SR-069/filter", files: DEMO_FILES };

/** The sheet colour of each scheme, as the browser reports it (the --sheet token). */
const SHEET = { light: "rgb(255, 255, 255)", dark: "rgb(22, 24, 27)" } as const;

const style = (window: Page, selector: string, property: string): Promise<string> =>
  window.evaluate(
    ([at, name]) => {
      const element = document.querySelector(at);
      return element === null ? "" : getComputedStyle(element).getPropertyValue(name);
    },
    [selector, property] as const,
  );

const opened = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(DEMO_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(DEMO_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(DEMO_TITLE);
};

for (const scheme of ["light", "dark"] as const) {
  test(`the candidates are a card and the modeline a bar of segments (${scheme})`, async () => {
    const running = await launchApp(FIXTURE, { colorScheme: scheme });
    const { window } = running;
    try {
      await listAll(window);
      await opened(window);
      // The modeline: one rounded bar; the element, the hint count and the workspace are segments of it.
      const segments = window.locator(".modeline .segment");
      expect(await segments.count()).toBeGreaterThanOrEqual(2);
      await expect(window.locator(".modeline .parts .segment").first()).toContainText(" · ");
      await expect(window.locator(".modeline .workspace .segment").first()).toHaveText("Weather station");
      expect(await style(window, ".modeline", "border-top-left-radius")).not.toBe("0px");
      const bar = await style(window, ".modeline", "background-color");
      expect(bar).not.toBe(SHEET[scheme]);
      expect(await style(window, ".modeline .parts .segment", "background-color")).not.toBe(bar);
      // The title bar strip is there on macOS only: elsewhere the native frame names the window.
      await expect(window.locator(".titlebar")).toHaveCount(process.platform === "darwin" ? 1 : 0);
      // The command prompt: its candidates are a card with its own tone, an edge and a shadow.
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
      const card = await style(window, ".candidates", "background-color");
      expect(card).not.toBe(SHEET[scheme]);
      expect(card).toBe(bar);
      expect(await style(window, ".candidates", "box-shadow")).not.toBe("none");
      expect(await style(window, ".candidates", "border-top-width")).toBe("1px");
      expect(await style(window, ".candidates", "border-top-left-radius")).not.toBe("0px");
    } finally {
      await running.close();
    }
  });
}

test("on macOS a strip of the sheet moves the window and names it, in the colours of the scheme", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: "light" });
  const { app, window } = running;
  try {
    await listAll(window);
    await app.context().addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    });
    await window.reload();
    const strip = window.locator(".titlebar");
    await expect(strip).toHaveText("Weather station - LogReq");
    expect(await window.title()).toBe("Weather station - LogReq");
    expect(await style(window, ".titlebar", "-webkit-app-region")).toBe("drag");
    expect(await style(window, ".titlebar", "background-color")).toBe(SHEET.light);
    await expect(strip.locator("button, input, a, [tabindex]")).toHaveCount(0);
    // Toggle dark mode: the strip follows the sheet. The emulated macOS takes Cmd only (#543).
    await window.keyboard.press(`${await modifier(window)}+Shift+P`);
    await window.keyboard.type("Toggle dark mode");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Toggle dark mode");
    await window.keyboard.press("Enter");
    await expect.poll(() => style(window, ".titlebar", "background-color")).toBe(SHEET.dark);
  } finally {
    await running.close();
  }
});
