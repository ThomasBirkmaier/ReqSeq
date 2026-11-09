// Screenshots of the app for the user documentation (ADR-0017, #344), light, 1024×576. Those of Get started (the
// overview, the requirement, the command prompt, the neighbourhood of the need) and of "Write the text of an
// element" (the slash menu) are made on `fixtures/SR-140/get-started`: exactly the need and the requirement the steps
// of Get started create, with the same IDs (#1253). The traceability matrix and the graph of the standard model are
// made on `fixtures/enabler-344/weather-station`, which has more elements; the graph in a window of 1600×1000, cut
// to its boxes. The verification marks of "Record test evidence" and the graph of "Trace a requirement" (#1248)
// are made on `fixtures/SR-136/graph`, whose need has ten requirements with every status. They go to
// `test-results/electron/guide-images/` (the CI artifact), and with REQSEQ_GUIDE_IMAGES set (`pnpm docs:screenshots`) also to `docs/guide/images/`, the site's
// copy, committed after a run; a normal run leaves tracked files alone. They are made on Linux only, because fonts
// differ between systems, and nothing compares pixels.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { expectNextToLine } from "./support/tooltip-place.js";

const GET_STARTED = { fixture: "SR-140/get-started" };
const WEATHER_STATION = { fixture: "enabler-344/weather-station" };
const VERIFICATION = { fixture: "SR-136/graph" };
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

/** Writes a screenshot of the window, or of `clip` of it, as `app-<name>.png` into each folder. */
const shooter =
  (window: Page) =>
  async (name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> => {
    const png = await window.screenshot({ animations: "disabled", caret: "hide", ...(clip && { clip }) });
    await Promise.all(FOLDERS.map((folder) => fs.writeFile(path.join(folder, `app-${name}.png`), png)));
  };

test.skip(process.platform !== "linux", "the guide's screenshots are made on Linux only (ADR-0017)");

test.beforeAll(async () => {
  await Promise.all(FOLDERS.map((folder) => fs.mkdir(folder, { recursive: true })));
});

test("screenshots of Get started and of the text editor, on the workspace the steps of Get started create", async () => {
  const running = await launchApp(GET_STARTED, { colorScheme: "light" });
  const { window } = running;
  try {
    await resize(running, 1024, 576);
    const shot = shooter(window);

    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await expect(window.getByLabel("Modeline")).toContainText("2 elements");
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
    await expect(window.locator('[role="tree"] [role="treeitem"]')).toHaveCount(1);
    await shot("neighbourhood");

    // "Write the text of an element": the slash menu on a new line below the text, before anything is typed after
    // the slash.
    await open(window, "Show the wind speed");
    await window.locator("article").focus();
    await window.keyboard.press("Enter");
    await expect(window.locator('[data-field="Text"] .cm-content')).toBeFocused();
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await window.keyboard.type("/");
    const menu = window.locator(".cm-tooltip-autocomplete:not(.cm-lr-slash-leaving)");
    await expect(menu.locator("li").first()).toBeVisible();
    await expect(window.locator(".cm-lr-slash-leaving")).toHaveCount(0);
    // In place next to the line, not where CodeMirror first measures it (#1126).
    await expectNextToLine(menu, window.locator('[data-field="Text"] .cm-line').last());
    await shot("slash-menu");
  } finally {
    await running.close();
  }
});

test("screenshots of the traceability matrix and the standard model", async () => {
  const running = await launchApp(WEATHER_STATION, { colorScheme: "light" });
  const { window } = running;
  try {
    await resize(running, 1024, 576);
    const shot = shooter(window);

    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await expect(window.getByLabel("Modeline")).toContainText("5 elements");

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

    // The standard model (the fixture's metamodel is the one `workspace.init` writes), on its own page: the
    // graph of its six types and "Any type", cut to the boxes and the names of their relations.
    // Tall enough for the boxes and their margin; a box below the window would be cut off unseen.
    const [wide, high] = [1600, 1200];
    await resize(running, wide, high);
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
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + margin;
    // The modeline stands at the bottom of the window: the image ends above it.
    const modeline = await window.getByLabel("Modeline").boundingBox();
    expect(bottom).toBeLessThanOrEqual(modeline?.y ?? high);
    await shot("standard-model", {
      x,
      y,
      width: Math.min(wide, Math.max(...boxes.map((box) => box.x + box.width)) + right) - x,
      height: bottom - y,
    });
  } finally {
    await running.close();
  }
});

test("screenshots of the verification status: the marks on a requirement and the graph of a need", async () => {
  const running = await launchApp(VERIFICATION, { colorScheme: "light" });
  const { window } = running;
  try {
    await resize(running, 1024, 576);
    const shot = shooter(window);
    await expect(window.getByLabel("Modeline")).toContainText("Weather station");

    // A requirement whose test failed: its badge in the accent colour.
    await open(window, "Show reading 7");
    await expect(window.locator('article .badge[data-status="failed"]')).toBeVisible();
    await shot("verification-badges");

    // The need: each requirement with its status and ring, the need with its degree.
    // The need in the middle of the window, with the requirements next to it below.
    await open(window, "See the weather");
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(window.locator(".graph")).toHaveAttribute("data-laid-out", "12");
    await shot("verification-graph");
  } finally {
    await running.close();
  }
});
