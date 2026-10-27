// The traceability matrix (SR-125) on a copy of the repository's own specification (`spec/`): the way to
// "all system requirements of the package Stufe-3 as a matrix" by keyboard, with the keys counted, and a
// screenshot of the matrix in light mode (1280×800). The PNG goes to `test-results/electron/screenshots/`
// (or the folder in LOGREQ_SCREENSHOTS); keeping it is a deliberate step, not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEFAULT_SORT, launchApp } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Presses keys and counts them: a shortcut is one key, each typed character is one. */
const keys = (window: Page) => {
  let count = 0;
  return {
    count: () => count,
    press: async (key: string): Promise<void> => {
      count += 1;
      await window.keyboard.press(key);
    },
    type: async (text: string): Promise<void> => {
      count += text.length;
      await window.keyboard.type(text);
    },
  };
};

const titles = (window: Page): Promise<string[]> =>
  window.locator("tbody tr td.element .title").allTextContents();

test("[SR-125/AK1] all system requirements of the package Stufe-3 as a matrix: from the overview and from the package page", async () => {
  const running = await launchApp({ folder: SPEC }, { colorScheme: "light" });
  const { window } = running;
  try {
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await expect(window.getByLabel("Modeline")).toContainText("elements");
    const cli = JSON.parse(
      (
        await running.cli([
          "trace",
          "matrix",
          "--input",
          JSON.stringify({
            selection: { where: { all: [{ type: ["system-requirement"] }, { package: "Stufe-3" }] } },
            sort: DEFAULT_SORT,
            limit: 5000,
          }),
        ])
      ).stdout,
    ) as { total: number; rows: { title: string }[] };
    expect(cli.total).toBeGreaterThan(0);

    // The overview: the line "System Requirement", Enter, then the packages filter and Ctrl+T.
    const typed = keys(window);
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    const lines = await window.locator(".overview .line").allTextContents();
    const at = lines.findIndex((line) => line.startsWith("System Requirement"));
    expect(at).toBeGreaterThanOrEqual(0);
    // No line is selected at the start (SR-122): Enter opens the first line, and the first Down selects it.
    const downs = at === 0 ? 0 : at + 1;
    for (let step = 0; step < downs; step += 1) {
      await typed.press("ArrowDown");
    }
    await typed.press("Enter");
    await expect(window.locator(".row").first()).toBeVisible();
    await typed.press("ControlOrMeta+Shift+P");
    await typed.type("flp");
    await typed.press("Enter");
    // The values come from a command: keys typed before the prompt is there would be lost, so the test waits.
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Property");
    await typed.type("pa");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("packages");
    await typed.press("Enter");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("packages");
    await typed.type("st3");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Stufe-3");
    await typed.press("Enter");
    await typed.press("ControlOrMeta+T");
    await expect(window.locator("tbody tr")).toHaveCount(cli.total);
    const fromOverview = typed.count();
    expect(await titles(window)).toEqual(cli.rows.map((row) => row.title));
    test.info().annotations.push({ type: "keys from the overview", description: String(fromOverview) });
    // Down ×(at+1) to the line "System Requirement" (none on the first line), Enter, Ctrl+Shift+P, flp,
    // Enter, pa, Enter, st3, Enter, Ctrl+T.
    expect(fromOverview).toBe(downs + 14);

    // The package page: Ctrl+P, the title, Enter, Ctrl+T.
    const direct = keys(window);
    await direct.press("ControlOrMeta+P");
    await direct.type("Stufe-3");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Stufe-3");
    await direct.press("Enter");
    await expect(window.locator("article h1")).toContainText("Stufe 3");
    await expect(window.locator(".members .row").first()).toBeVisible();
    await direct.press("ControlOrMeta+T");
    // Every member of the package, whatever its type: the CLI's matrix of the package.
    const members = JSON.parse(
      (
        await running.cli([
          "trace",
          "matrix",
          "--input",
          JSON.stringify({ selection: { package: "Stufe-3" }, sort: DEFAULT_SORT, limit: 5000 }),
        ])
      ).stdout,
    ) as { total: number; rows: { title: string }[] };
    await expect(window.locator("tbody tr")).toHaveCount(members.total);
    expect(await titles(window)).toEqual(members.rows.map((row) => row.title));
    // Ctrl+P, the seven characters of Stufe-3, Enter, Ctrl+T.
    expect(direct.count()).toBe(10);
    test.info().annotations.push({ type: "keys from the package page", description: String(direct.count()) });

    await window.locator("tbody tr").first().waitFor();
    await window.screenshot({ path: path.join(OUT, "matrix.png") });
  } finally {
    await running.close();
  }
});
