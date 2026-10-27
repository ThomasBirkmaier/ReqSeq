// Screenshots of the graph (SR-111), light and dark:
// - on a copy of the repository's own specification (`spec/`): the graph of SR-111 at depth 1 and at all
//   levels over every kind (the chain up to its need and down through the references of the decisions),
//   that of the package Stufe-3 with its members in one wide layer, and the whole chain of the glossary
//   term GL-f81ba9 (a node whose walk parent took its level from the other walk, #519);
// - on the generated workspaces of SR-111 AK6: a package graph of 500 nodes at depth 1 and a whole chain
//   of 500 nodes, both laid out in the layers of their levels (#500).
// The window is 1280×800. The PNGs go to `test-results/electron/screenshots/` (or the folder in
// LOGREQ_SCREENSHOTS); keeping them is a deliberate step, not part of a test run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import type { GraphDeepFixture } from "./support/graph-deep-fixture.js";
import { writeGraphDeepFixture } from "./support/graph-deep-fixture.js";
import type { GraphFixture } from "./support/graph-fixture.js";
import { writeGraphFixture } from "./support/graph-fixture.js";

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

      // The whole chain of GL-f81ba9: Gültigkeit (level 2) below the element, Kern (level -1) above it.
      await open(window, "GL-f81ba9", "Basisumfang");
      await window.keyboard.press("ControlOrMeta+Shift+G");
      for (let press = 0; press < 9; press += 1) {
        await window.keyboard.press("+");
      }
      await expect(window.getByLabel("Modeline")).toContainText("whole chain");
      const term = await nodeCount(running, { ref: "GL-f81ba9", allLevels: true });
      await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", String(term));
      await shot("glossary-all-levels");
    } finally {
      await running.close();
    }
  });
}

test.describe("screenshots of graphs of 500 nodes", () => {
  let wide: GraphFixture;
  let deep: GraphDeepFixture;

  test.beforeAll(async () => {
    // Two generated workspaces of 1,500 elements each, with their links' versions confirmed.
    test.setTimeout(600_000);
    wide = await writeGraphFixture();
    deep = await writeGraphDeepFixture();
  });

  test.afterAll(async () => {
    await wide.cleanup();
    await deep.cleanup();
  });

  /** Opens the root by Ctrl+P and its title, then its graph, and shoots it once it has 500 nodes. */
  const shoot = async (
    folder: string,
    title: string,
    deeper: boolean,
    file: string,
    scheme: "light" | "dark",
  ): Promise<void> => {
    const running = await launchApp({ folder }, { colorScheme: scheme });
    const { window } = running;
    try {
      await fs.mkdir(OUT, { recursive: true });
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      // Until the workspace is loaded: 1,500 elements can take longer than expect's 5 s on a loaded
      // runner, so this waits for the condition within the test's own bound.
      await expect(window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
      await window.keyboard.press("ControlOrMeta+P");
      await window.keyboard.type(title);
      await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
      await window.keyboard.press("Enter");
      await expect(window.locator("article h1")).toHaveText(title);
      await window.keyboard.press("ControlOrMeta+Shift+G");
      if (deeper) {
        await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", /\d+/);
        await window.keyboard.press("+");
      }
      await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", "500", { timeout: 30_000 });
      await window.screenshot({ path: path.join(OUT, `sr-111-${file}-${scheme}.png`) });
    } finally {
      await running.close();
    }
  };

  for (const scheme of ["light", "dark"] as const) {
    test(`screenshots of a package graph and a whole chain of 500 nodes (${scheme})`, async () => {
      test.setTimeout(120_000);
      await shoot(wide.folder, wide.roots[0]?.title ?? "", false, "big-package", scheme);
      await shoot(deep.folder, deep.roots[0]?.title ?? "", true, "big-chain", scheme);
    });
  }
});
