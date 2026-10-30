// Screenshots of the app for the user documentation (ADR-0017, #344): the overview, an open requirement, the
// command prompt and the neighbourhood of a need, on the fixed workspace `fixtures/enabler-344/weather-station`
// (the elements of Get started, with the same IDs), light, 1024×576. They go to
// `test-results/electron/guide-images/` (the CI artifact), and with REQSEQ_GUIDE_IMAGES set (`pnpm docs:screenshots`)
// also to `docs/guide/images/`, the site's copy, committed after a run; a normal run leaves tracked files alone. They
// are made on Linux only, because fonts differ between systems, and nothing compares pixels.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp } from "./support/app.js";

const FIXTURE = { fixture: "enabler-344/weather-station" };
const folder = (relative: string): string => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const FOLDERS = [
  folder("test-results/electron/guide-images"),
  ...((process.env["REQSEQ_GUIDE_IMAGES"] ?? "") === "" ? [] : [folder("docs/guide/images")]),
];

const candidates = (window: Page) => window.locator('.candidates [role="option"]');
const text = (window: Page) => window.getByRole("textbox", { name: "Text" });

/** Opens an element by Ctrl+P and its title, once the hit is there. */
const open = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(text(window)).toBeVisible();
};

test.skip(process.platform !== "linux", "the guide's screenshots are made on Linux only (ADR-0017)");

test("screenshots of the app for the user guide", async () => {
  const running = await launchApp(FIXTURE, { colorScheme: "light" });
  const { window } = running;
  try {
    await Promise.all(FOLDERS.map((folder) => fs.mkdir(folder, { recursive: true })));
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 576);
    });
    const shot = async (name: string): Promise<void> => {
      const png = await window.screenshot({ animations: "disabled", caret: "hide" });
      await Promise.all(FOLDERS.map((folder) => fs.writeFile(path.join(folder, `app-${name}.png`), png)));
    };

    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await expect(window.getByLabel("Modeline")).toContainText("5 elements");
    await shot("overview");

    await open(window, "Show the wind speed");
    await expect(text(window)).toContainText("updated every 10 seconds");
    await shot("element");

    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("show");
    await expect(candidates(window).first()).toContainText("Show");
    await shot("command-prompt");
    await window.keyboard.press("Escape");

    await open(window, "See the wind speed");
    await window.keyboard.press("ControlOrMeta+J");
    await expect(window.locator('[role="tree"] [role="treeitem"]')).toHaveCount(2);
    await shot("neighbourhood");
  } finally {
    await running.close();
  }
});
