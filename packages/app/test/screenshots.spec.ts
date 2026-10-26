// Screenshots of the main view on a copy of the repository's own specification (`spec/`), for the
// verification record of SR-100 (verification/SR-100.md). The window is 1280×800. The PNGs go to
// `test-results/electron/screenshots/` (or the folder in LOGREQ_SCREENSHOTS); copying them to
// `verification/SR-100/` is a deliberate step, not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp, listAll } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

test("screenshots of the main view on the specification workspace", async () => {
  const running = await launchApp({ folder: SPEC });
  const { window } = running;
  try {
    await fs.mkdir(OUT, { recursive: true });
    const shot = (name: string): Promise<Buffer> =>
      window.screenshot({ path: path.join(OUT, `${name}.png`) });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    const candidates = (page: Page) => page.locator('.candidates [role="option"]');

    // The total in the modeline is the CLI's, not a number that the spec outgrows.
    const listed = JSON.parse((await running.cli(["element", "list", "--limit", "1"])).stdout) as {
      total: number;
    };
    await expect(window.getByLabel("Modeline")).toContainText(`${String(listed.total)} elements`);
    // The first buffer is the calm overview (SR-118): a line per type with its count.
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Overview");
    await expect(window.getByRole("option", { name: /^System Requirement \d+$/ })).toBeVisible();
    await shot("overview-start");
    // A type line opens the list of that type.
    await window.getByRole("option", { name: /^System Requirement \d+$/ }).click();
    await expect(window.getByLabel("Modeline")).toContainText("type: system-requirement");
    await expect(window.locator(".row").first()).toBeVisible();
    await shot("overview-type-list");
    await listAll(window);
    await shot("main-view-list");

    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("sort");
    await expect(candidates(window).first()).toContainText("Sort list");
    await shot("main-view-commands");
    await window.keyboard.press("Escape");

    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("hauptansicht");
    await expect(candidates(window).first()).toContainText("Hauptansicht schlank halten");
    await shot("main-view-jump");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Hauptansicht schlank halten");
    await shot("main-view-element");

    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("sort list");
    await window.keyboard.press("Enter");
    await window.keyboard.type("hierarchy");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Modeline")).toContainText("All elements · tree");
    await expect(window.locator(".row").first()).toBeVisible();
    // The roots come first; go down to the first element below one, so the tree shows.
    const selectedIndent = (): Promise<string> =>
      window
        .locator('.row[aria-selected="true"] .title')
        .evaluate((e) => (e as HTMLElement).style.paddingLeft);
    for (let pages = 0; pages < 30 && (await selectedIndent()) === "0rem"; pages += 1) {
      await window.keyboard.press("PageDown");
    }
    expect(await selectedIndent()).not.toBe("0rem");
    await shot("main-view-tree");

    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("Befehlszeile");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Modeline")).toContainText("Search: Befehlszeile");
    await expect(window.locator(".row").first()).toBeVisible();
    await shot("main-view-search");
  } finally {
    await running.close();
  }
});
