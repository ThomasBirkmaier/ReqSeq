// Screenshots of the light and the dark sheet for the verification record of SR-113
// (verification/SR-113.md). The window is 1280×800. The PNGs go to `test-results/electron/screenshots/`
// (or the folder in LOGREQ_SCREENSHOTS); copying them to `verification/SR-113/` is a deliberate step,
// not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";
import { DEMO_FILES, DEMO_TITLE, REFERENCE_FILES, REFERENCE_SOURCE_TITLE } from "./support/demo.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const prepare = async (running: RunningApp): Promise<(name: string) => Promise<Buffer>> => {
  await fs.mkdir(OUT, { recursive: true });
  await running.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
  });
  await listAll(running.window);
  return (name) => running.window.screenshot({ path: path.join(OUT, `${name}.png`) });
};

const opened = async (window: Page, query: string, title = query): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(query);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator(".cm-content")).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

for (const scheme of ["light", "dark"] as const) {
  test(`screenshot of the list in ${scheme}`, async () => {
    const running = await launchApp({ folder: SPEC }, { colorScheme: scheme });
    try {
      const shot = await prepare(running);
      await shot(`theme-${scheme}-list`);
    } finally {
      await running.close();
    }
  });
}

test("screenshot of the command prompt in dark", async () => {
  const running = await launchApp({ folder: SPEC }, { colorScheme: "dark" });
  const { window } = running;
  try {
    const shot = await prepare(running);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("dark");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Toggle dark mode");
    await shot("theme-dark-commands");
  } finally {
    await running.close();
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots of the demo element and the outdated reference in ${scheme}`, async () => {
    const running = await launchApp(
      { fixture: "SR-069/filter", files: { ...DEMO_FILES, ...REFERENCE_FILES } },
      { colorScheme: scheme },
    );
    const { window } = running;
    try {
      const shot = await prepare(running);
      await opened(window, DEMO_TITLE);
      await expect(window.locator(".cm-content table.cm-lr-table")).toHaveCount(1);
      await shot(`theme-${scheme}-element`);
      await opened(window, REFERENCE_SOURCE_TITLE);
      await expect(window.locator(".cm-content .cm-lr-outdated").first()).toBeVisible();
      await shot(`theme-${scheme}-outdated`);
    } finally {
      await running.close();
    }
  });
}
