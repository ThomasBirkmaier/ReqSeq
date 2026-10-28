// Screenshots of the metamodel graph and text (SR-130), light and dark, the window 1280×800:
// - on a copy of the repository's own specification (`spec/`): its seven types, "Any type" with the
//   loop of Refines and Supersedes and the curve of Based on, and the relation properties Validity and
//   Package;
// - on fixtures/SR-130/metamodel: the inheritance chain, the loops, the pair of Software Requirement and
//   System Requirement with "extends" and Derives from on one curve, a close-up of Decision and "Any type"
//   (Based on and Traces to, one of them drawn afterwards, each with its arrowhead) and of the parent to
//   subtype curve Delegates to, and the graph with a type selected (its curves lit);
// - the text of both (Ctrl/Cmd+T), and on the fixture the text after the switch with Decision selected
//   in the graph: it opens on Decision.
// The PNGs go to `test-results/electron/screenshots/` (or the folder in LOGREQ_SCREENSHOTS); keeping them
// is a deliberate step, not part of a test run.
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

/** "Show metamodel" from the command prompt; waits until `boxes` boxes are laid out. */
const showMetamodel = async (window: Page, boxes: number): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Show metamodel");
  await expect(window.locator('.candidates [aria-selected="true"] .name')).toHaveText("Show metamodel");
  await window.keyboard.press("Enter");
  await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", String(boxes));
};

/** Ctrl/Cmd+T from the graph; waits until the text shows its rows. */
const showText = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+T");
  await expect(window.locator(".metamodel-text")).toBeFocused();
  await expect(window.locator(".metamodel-text")).toHaveAttribute("data-rows", /^[1-9]/);
};

/** The number of types `logreq metamodel get` gives, plus "Any type". */
const boxCount = async (running: RunningApp): Promise<number> =>
  (JSON.parse((await running.cli(["metamodel", "get"])).stdout) as { types: unknown[] }).types.length + 1;

/** Scrolls the view so that the boxes `keys` (and what lies between them) stand in it, and gives their area with a margin. */
const around = async (
  window: Page,
  selectors: readonly string[],
): Promise<{ x: number; y: number; width: number; height: number }> => {
  await window.locator(selectors[0] ?? "").scrollIntoViewIfNeeded();
  const rects = await Promise.all(selectors.map((selector) => window.locator(selector).boundingBox()));
  const xs = rects.flatMap((rect) => (rect === null ? [] : [rect.x, rect.x + rect.width]));
  const ys = rects.flatMap((rect) => (rect === null ? [] : [rect.y, rect.y + rect.height]));
  const margin = 96;
  const x = Math.max(0, Math.min(...xs) - margin);
  const y = Math.max(0, Math.min(...ys) - margin);
  return {
    x,
    y,
    width: Math.min(1280 - x, Math.max(...xs) + margin * 2.5 - x),
    height: Math.min(800 - y, Math.max(...ys) + margin - y),
  };
};

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots of the metamodel graph (${scheme})`, async () => {
    test.setTimeout(120_000);
    await fs.mkdir(OUT, { recursive: true });
    const size = async (running: RunningApp): Promise<void> => {
      await running.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
      });
      await expect
        .poll(() => running.window.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]))
        .toEqual([1280, 800]);
    };

    const spec = await launchApp({ folder: SPEC }, { colorScheme: scheme });
    try {
      await size(spec);
      await expect(spec.window.getByLabel("Modeline")).toContainText("elements", { timeout: 0 });
      await showMetamodel(spec.window, await boxCount(spec));
      await spec.window.screenshot({ path: path.join(OUT, `sr-130-spec-graph-${scheme}.png`) });
      await showText(spec.window);
      await spec.window.screenshot({ path: path.join(OUT, `sr-130-spec-text-${scheme}.png`) });
    } finally {
      await spec.close();
    }

    const fixture = await launchApp({ fixture: "SR-130/metamodel" }, { colorScheme: scheme });
    const { window } = fixture;
    try {
      await size(fixture);
      await expect(window.getByLabel("Modeline")).toContainText("Weather station", { timeout: 0 });
      await showMetamodel(window, 6);
      await window.screenshot({ path: path.join(OUT, `sr-130-fixture-graph-${scheme}.png`) });
      await showText(window);
      await window.screenshot({ path: path.join(OUT, `sr-130-fixture-text-${scheme}.png`) });
      await window.keyboard.press("ControlOrMeta+T");
      await expect(window.locator(".metamodel")).toBeFocused();
      await window.screenshot({
        path: path.join(OUT, `sr-130-fixture-any-type-${scheme}.png`),
        clip: await around(window, ['[data-type="decision"]', "[data-any]"]),
      });
      await window.screenshot({
        path: path.join(OUT, `sr-130-fixture-subtype-${scheme}.png`),
        clip: await around(window, ['[data-type="requirement"]', '[data-type="software-requirement"]']),
      });
      // Decision selected: its curves lit (they are at most half of the curves).
      await window.keyboard.press("ArrowDown");
      await window.keyboard.press("ArrowRight");
      await expect(window.locator('.mm-type[aria-selected="true"]')).toHaveAttribute("data-type", "decision");
      await window.screenshot({ path: path.join(OUT, `sr-130-fixture-selected-${scheme}.png`) });
      await showText(window);
      await expect(window.locator('.mm-row[aria-selected="true"]')).toHaveAttribute(
        "data-row",
        "type:decision",
      );
      await window.screenshot({ path: path.join(OUT, `sr-130-fixture-text-selected-${scheme}.png`) });
    } finally {
      await fixture.close();
    }
  });
}
