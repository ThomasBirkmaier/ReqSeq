// Screenshots of the app for the user documentation (ADR-0017, #344): the overview, an open requirement, the
// command prompt, the neighbourhood of a need, the traceability matrix of the requirements and the graph of the
// standard model, on the fixed workspace `fixtures/enabler-344/weather-station` (the elements of Get started, with
// the same IDs, and the standard model), light, 1024×576; the graph in a window of 1600×1000, cut to its boxes. They go to
// `test-results/electron/guide-images/` (the CI artifact), and with REQSEQ_GUIDE_IMAGES set (`pnpm docs:screenshots`)
// also to `docs/guide/images/`, the site's copy, committed after a run; a normal run leaves tracked files alone. They
// are made on Linux only, because fonts differ between systems, and nothing compares pixels.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const FIXTURE = { fixture: "enabler-344/weather-station" };
const folder = (relative: string): string => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const FOLDERS = [
  folder("test-results/electron/guide-images"),
  ...((process.env["REQSEQ_GUIDE_IMAGES"] ?? "") === "" ? [] : [folder("docs/guide/images")]),
];

const candidates = (window: Page) => window.locator('.candidates [role="option"]');
const text = (window: Page) => window.getByRole("textbox", { name: "Text" });

/** The window's content size. */
const resize = async (running: RunningApp, width: number, height: number): Promise<void> => {
  await running.app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(w, h);
    },
    [width, height] as const,
  );
  await expect
    .poll(() => running.window.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]))
    .toEqual([width, height]);
};

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
    await resize(running, 1024, 576);
    const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
      const png = await window.screenshot({ animations: "disabled", caret: "hide", ...(clip && { clip }) });
      await Promise.all(FOLDERS.map((folder) => fs.writeFile(path.join(folder, `app-${name}.png`), png)));
    };

    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await expect(window.getByLabel("Modeline")).toContainText("5 elements");
    await shot("overview");

    // The end of "Trace a requirement": the requirements as a matrix, each with the need it derives from.
    const lines = await window.locator(".overview .line").allTextContents();
    const at = lines.findIndex((line) => line.startsWith("System Requirement"));
    expect(at).toBeGreaterThanOrEqual(0);
    // No line is selected at first (SR-122): the first Down selects the first line.
    for (let step = 0; step <= at; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await window.keyboard.press("Enter");
    await expect(window.locator(".row")).toHaveCount(3);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator("tbody tr")).toHaveCount(3);
    await shot("trace-matrix");

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

    // The standard model (the fixture's metamodel is the one `workspace.init` writes), on its own page and in the
    // README: the graph of its six types and "Any type", cut to the boxes and the names of their relations.
    await resize(running, 1600, 1000);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show metamodel");
    await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText("Show metamodel");
    await window.keyboard.press("Enter");
    await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", "7");
    const boxes = await window
      .locator(".mm-type, [data-any]")
      .evaluateAll((elements) =>
        elements
          .map((element) => element.getBoundingClientRect())
          .map(({ x, y, width, height }) => ({ x, y, width, height })),
      );
    const margin = 48;
    // The names of the loops stand right of the boxes.
    const right = 280;
    const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - margin);
    const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - margin);
    await shot("standard-model", {
      x,
      y,
      width: Math.min(1600, Math.max(...boxes.map((box) => box.x + box.width)) + right) - x,
      height: Math.min(1000, Math.max(...boxes.map((box) => box.y + box.height)) + margin) - y,
    });
  } finally {
    await running.close();
  }
});
