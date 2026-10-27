// Changes from outside the app on the built app (SR-116, SR-106 AK1): an agent changes an element
// through MCP, or a person through the CLI, while the app shows it. Core's watcher reports the change, the
// window shows the new content and highlights it briefly; an editor without input keeps its cursor.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** 14 elements with a derivation tree (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };
/** SR-0000b1 "Measure wind speed" and the text of its file. */
const ELEMENT = "SR-0000b1";
const TITLE = "Measure wind speed";
const TEXT = "b1: derives from N1, in package P1.";
const FILE = path.join("requirements", "SR-0000000000b1.md");
/** The caret after "derives" in the text. */
const CARET = "b1: derives".length;

/** SR-116 AK1: the new content within 2 s; AK2: no mark 3 s after the highlight. */
const SHOWN_WITHIN_MS = 2000;
const GONE_AFTER_MS = 3000;
/** One frame at 60 Hz. */
const FRAME_MS = 17;

/** The editor of the text (the property boxes have editors of their own). */
const text = (window: Page): Locator => window.getByRole("textbox", { name: "Text" });

const opened = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(text(window)).toBeVisible();
  await expect(window.locator("article")).toBeFocused();
};

test.describe("changes from outside the app", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-116/AK1] an element changed through MCP shows its new content within 2 s and is highlighted", async () => {
    const { window } = running;
    const mcp = await running.mcp();
    // A list row: the title an agent gives an element is in the list within 2 s, and its row is marked.
    const row = window.locator(".row", { hasText: "SR-0000b2" });
    await expect(row).toBeVisible();
    let start = Date.now();
    await mcp.call("element_update", { ref: "SR-0000b2", title: "Measure twice a second" });
    await expect(row.locator(".title")).toHaveText("Measure twice a second", {
      timeout: Math.max(1, SHOWN_WITHIN_MS - (Date.now() - start)),
    });
    expect(Date.now() - start).toBeLessThanOrEqual(SHOWN_WITHIN_MS);
    await expect(row).toHaveClass(/outside-change/);
    await expect(window.locator(".outside-change")).toHaveCount(1);
    // The element buffer: the text field that changed is marked, the title is not.
    await opened(window, TITLE);
    start = Date.now();
    await mcp.call("element_update", { ref: ELEMENT, text: `${TEXT}\n\nMeasured by the agent.` });
    await expect(text(window)).toContainText("Measured by the agent.", {
      timeout: Math.max(1, SHOWN_WITHIN_MS - (Date.now() - start)),
    });
    expect(Date.now() - start).toBeLessThanOrEqual(SHOWN_WITHIN_MS);
    await expect(window.locator('[data-field="Text"]')).toHaveClass(/outside-change/);
    await expect(window.locator('[data-field="Title"]')).not.toHaveClass(/outside-change/);
    // Quiet: the minibuffer says nothing about it (D-062).
    await expect(window.getByLabel("Minibuffer")).toHaveText("");
  });

  test("[SR-116/AK2] 3 s after the highlight no mark remains", async () => {
    const { window } = running;
    const mcp = await running.mcp();
    await opened(window, TITLE);
    // The page records when a mark comes and goes, by its own clock: what is measured is the app, not
    // the test process and its polling.
    await window.evaluate(() => {
      const log: { readonly kind: "shown" | "gone"; readonly at: number }[] = [];
      Reflect.set(globalThis, "outsideMarks", log);
      const has = (node: Node): boolean =>
        node instanceof Element &&
        (node.matches(".outside-change") || node.querySelector(".outside-change") !== null);
      new MutationObserver((records) => {
        for (const record of records) {
          const at = performance.now();
          if (record.type === "attributes" && record.target instanceof Element) {
            const before = (record.oldValue ?? "").split(/\s+/).includes("outside-change");
            const after = record.target.classList.contains("outside-change");
            if (before !== after) {
              log.push({ kind: after ? "shown" : "gone", at });
            }
          }
          for (const node of record.addedNodes) {
            if (has(node)) {
              log.push({ kind: "shown", at });
            }
          }
          for (const node of record.removedNodes) {
            if (has(node)) {
              log.push({ kind: "gone", at });
            }
          }
        }
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"],
        attributeOldValue: true,
      });
    });
    const marks = (): Promise<{ readonly kind: string; readonly at: number }[]> =>
      window.evaluate(() => Reflect.get(globalThis, "outsideMarks") as { kind: string; at: number }[]);
    await mcp.call("element_update", { ref: ELEMENT, title: "Measure the wind speed" });
    await expect(window.locator("article h1")).toHaveText("Measure the wind speed");
    await expect
      .poll(async () => (await marks()).map((mark) => mark.kind), { timeout: GONE_AFTER_MS + 2000 })
      .toEqual(["shown", "gone"]);
    const [shown, gone] = await marks();
    // Gone within 3 s of being shown, with one frame of tolerance. AK2 promises only this bound; the
    // timer starts before the mark is drawn, so no lower bound is measured here.
    expect((gone?.at ?? 0) - (shown?.at ?? 0)).toBeLessThanOrEqual(GONE_AFTER_MS + FRAME_MS);
    await window.waitForTimeout(500);
    await expect(window.locator(".outside-change")).toHaveCount(0);
    expect((await marks()).map((mark) => mark.kind)).toEqual(["shown", "gone"]);
  });

  test("[SR-106/AK1] without unsaved input an outside change shows the new content and the cursor keeps its place", async () => {
    const { window } = running;
    await opened(window, TITLE);
    // The caret after "derives": Enter puts it into the text, then to the start of the text and right.
    await window.keyboard.press("Enter");
    await window.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
    for (let moved = 0; moved < CARET; moved += 1) {
      await window.keyboard.press("ArrowRight");
    }
    // A person changes the file through the CLI: a word before the caret.
    const changed = `Now: ${TEXT}`;
    const update = await running.cli(["element", "update", ELEMENT, "--text", changed]);
    expect(update.code).toBe(0);
    await expect(text(window)).toHaveText(changed);
    await expect(window.getByLabel("Modeline")).not.toContainText("modified");
    // Typing goes where the caret was, after the same word, and saving writes it there.
    await window.keyboard.type("X");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(window.getByLabel("Minibuffer")).toHaveText(`Saved ${ELEMENT} ${TITLE}`);
    const file = await fs.readFile(path.join(running.workspace?.root ?? "", FILE), "utf8");
    expect(file).toContain("Now: b1: derivesX from N1, in package P1.");
  });

  test("the app's own save is neither highlighted nor echoed as a change on disk", async () => {
    const { window } = running;
    await opened(window, TITLE);
    await window.keyboard.press("Enter");
    await window.keyboard.type(" Saved here.");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(window.getByLabel("Minibuffer")).toHaveText(`Saved ${ELEMENT} ${TITLE}`);
    // Longer than a batch of the watcher takes (at most 1 s).
    await window.waitForTimeout(1500);
    await expect(window.locator(".outside-change")).toHaveCount(0);
    await expect(window.getByLabel("Minibuffer")).toHaveText(`Saved ${ELEMENT} ${TITLE}`);
  });
});
