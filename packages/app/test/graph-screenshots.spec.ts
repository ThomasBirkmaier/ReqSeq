// Screenshots of the graph (SR-111) on a copy of the repository's own specification (`spec/`), light and
// dark: the graph of SR-111 at depth 1 and at all levels over every kind (the chain up to its need and
// down through the references of the decisions), and that of the package Stufe-3 with its members in one
// wide layer.
// The window is 1280×800. The PNGs go to `test-results/electron/screenshots/` (or the folder in
// LOGREQ_SCREENSHOTS); keeping them is a deliberate step, not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** Opens an element by Ctrl+P and its ID, once the hit is there. */
const open = async (window: Page, id: string, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(id);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(id);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

/** The number of nodes `logreq trace graph` gives for the input. */
const nodeCount = async (running: RunningApp, input: Record<string, unknown>): Promise<number> =>
  (
    JSON.parse(
      (await running.cli(["trace", "graph", "--input", JSON.stringify({ limit: 500, ...input })])).stdout,
    ) as { nodes: unknown[] }
  ).nodes.length;

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots of the graph on the specification workspace (${scheme})`, async () => {
    const running = await launchApp({ folder: SPEC }, { colorScheme: scheme });
    const { window } = running;
    try {
      await fs.mkdir(OUT, { recursive: true });
      const shot = (name: string): Promise<Buffer> =>
        window.screenshot({ path: path.join(OUT, `sr-111-${name}-${scheme}.png`) });
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      await expect(window.getByLabel("Modeline")).toContainText("elements");

      // SR-111 at depth 1, then at all levels over every kind: `+` up to the whole chain.
      await open(window, "SR-111", "Graph des aktuellen Elements zeigen");
      await window.keyboard.press("ControlOrMeta+Shift+G");
      const one = await nodeCount(running, { ref: "SR-111", maxDepth: 1 });
      await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", String(one));
      await shot("depth-1");
      for (let press = 0; press < 9; press += 1) {
        await window.keyboard.press("+");
      }
      await expect(window.getByLabel("Modeline")).toContainText("whole chain");
      const all = await nodeCount(running, { ref: "SR-111", allLevels: true });
      await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", String(all));
      await shot("all-levels");

      // The package Stufe-3: its members in one layer below it.
      await open(window, "Stufe-3", "Stufe 3: Oberfläche");
      await window.keyboard.press("ControlOrMeta+Shift+G");
      const members = await nodeCount(running, { ref: "Stufe-3", maxDepth: 1 });
      await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", String(members));
      await shot("package");
    } finally {
      await running.close();
    }
  });
}
