// Criterion keys in the acceptance criteria box on the built app (SR-204 AK7, AK8, AK9): rewording,
// moving, splitting and merging keep a key, new and pasted lines get a new one, and undo after a save
// brings the old keys back into the file. Each result is read with the CLI (`element get`). Keys use
// ControlOrMeta (Linux and macOS); Alt is Option on macOS.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { criteriaMetamodel } from "./support/boxes.js";

const SR_ID = "20420420-0000-4000-8000-0000000000c7";
const SR_TITLE = "Windrichtung anzeigen";
const OTHER_ID = "20420420-0000-4000-8000-0000000000c8";
const OTHER_TITLE = "Böen melden";
const KEYS = ["kaaa", "kbbb", "kccc"];

const requirement = (id: string, title: string, criteria: string): string => `---
id: ${id}
type: system-requirement
status: draft
title: ${title}
requirement-type: functional
acceptance-criteria:
${criteria}---

Das Tool zeigt die Windrichtung.
`;

const FILES = {
  "requirements/SR-0000000000c7.md": requirement(
    SR_ID,
    SR_TITLE,
    "  - key: kaaa\n    text: Alpha\n  - key: kbbb\n    text: Beta\n  - key: kccc\n    text: Gamma\n",
  ),
  "requirements/SR-0000000000c8.md": requirement(OTHER_ID, OTHER_TITLE, "  - key: kddd\n    text: Delta\n"),
};

interface Stored {
  readonly key?: string;
  readonly text: string;
}

const criteriaBox = (window: Page): Locator => window.locator('[data-field="acceptance-criteria"]');
const line = (window: Page, at: number): Locator => criteriaBox(window).locator(".cm-line").nth(at);

/** Opens an element with "Go to"; the buffer has the focus. */
const open = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

/**
 * Puts the caret at the start of the line `at` of the box, with a click at its left edge. The middle of a line
 * may be its reference mark (SR-205 AK1), and a press on the mark puts the caret at the end of the line, not
 * where the text was clicked. The marks come with `element.get` after the box, so a click in the middle
 * depended on timing (#1595).
 */
const caretIn = async (window: Page, at: number): Promise<void> => {
  const target = line(window, at);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await target.click({ position: { x: 1, y: (box?.height ?? 0) / 2 } });
};

/** Puts the caret at the end of the line `at` of the box. */
const endOf = async (window: Page, at: number): Promise<void> => {
  await caretIn(window, at);
  await window.keyboard.press("End");
};

test.describe("criterion keys in the editor", () => {
  let running: RunningApp;
  let clipboard: string;
  test.beforeEach(async () => {
    running = await launchApp({
      fixture: "SR-069/filter",
      files: { ...FILES, "metamodel/standard-model.yaml": await criteriaMetamodel() },
    });
    clipboard = await running.app.evaluate(({ clipboard: board }) => board.readText());
    await open(running.window, SR_TITLE);
    // The page has the criteria of `element.get`: each line shows its mark (SR-205 AK1).
    await expect(criteriaBox(running.window).locator(".cm-lr-criterion-ref")).toHaveCount(3);
  });
  test.afterEach(async () => {
    try {
      await running.app.evaluate(({ clipboard: board }, text) => board.writeText(text), clipboard);
    } finally {
      await running.close();
    }
  });

  /** The criteria as the file holds them, read with the CLI. */
  const stored = async (): Promise<Stored[]> => {
    const got = await running.cli(["element", "get", SR_ID]);
    const output = JSON.parse(got.stdout) as { element: { properties: Record<string, unknown> } };
    return (output.element.properties["acceptance-criteria"] as Stored[]).map((item) =>
      typeof item === "string" ? { text: item } : item,
    );
  };

  /** Saves at once (Ctrl/Cmd+S), and waits until the file holds `texts`. */
  const saved = async (texts: readonly string[]): Promise<Stored[]> => {
    await running.window.keyboard.press("ControlOrMeta+s");
    let items: Stored[] = [];
    await expect
      .poll(async () => {
        items = await stored();
        return items.map((item) => item.text);
      })
      .toEqual(texts);
    return items;
  };

  const keysOf = (items: readonly Stored[]): (string | undefined)[] => items.map((item) => item.key);

  test("[SR-204/AK-syqv] rewording, moving, splitting and merging keep the keys; a line emptied is dropped", async () => {
    const { window } = running;
    await endOf(window, 1);
    await window.keyboard.type(" two");
    expect(keysOf(await saved(["Alpha", "Beta two", "Gamma"]))).toEqual(KEYS);
    // Alt+Down moves the line with the caret one place down.
    await window.keyboard.press("Alt+ArrowDown");
    expect(keysOf(await saved(["Alpha", "Gamma", "Beta two"]))).toEqual(["kaaa", "kccc", "kbbb"]);
    // Enter in "Alpha" splits it: the first part keeps the key, the rest is a new criterion.
    await caretIn(window, 0);
    await window.keyboard.press("Home");
    await window.keyboard.press("ArrowRight");
    await window.keyboard.press("ArrowRight");
    await window.keyboard.press("Enter");
    const split = await saved(["Al", "pha", "Gamma", "Beta two"]);
    expect(keysOf(split)[0]).toBe("kaaa");
    expect(KEYS).not.toContain(split[1]?.key);
    expect(keysOf(split).slice(2)).toEqual(["kccc", "kbbb"]);
    // Backspace at the start of "pha" merges it back: the front one keeps its key.
    await window.keyboard.press("Backspace");
    expect(keysOf(await saved(["Alpha", "Gamma", "Beta two"]))).toEqual(["kaaa", "kccc", "kbbb"]);
    // A line emptied holds no criterion.
    await endOf(window, 1);
    await window.keyboard.press("Shift+Home");
    await window.keyboard.press("Backspace");
    expect(keysOf(await saved(["Alpha", "Beta two"]))).toEqual(["kaaa", "kbbb"]);
  });

  test("[SR-204/AK-pks0] new and pasted lines get new keys, also with the text of a criterion, also after a cut", async () => {
    const { window } = running;
    // A new line with the text of an existing criterion.
    await endOf(window, 2);
    await window.keyboard.press("Enter");
    await window.keyboard.type("Alpha");
    const added = await saved(["Alpha", "Beta", "Gamma", "Alpha"]);
    expect(keysOf(added).slice(0, 3)).toEqual(KEYS);
    expect(KEYS).not.toContain(added[3]?.key);
    // Two lines copied and pasted at the end.
    await caretIn(window, 0);
    await window.keyboard.press("Home");
    await window.keyboard.press("Shift+ArrowDown");
    await window.keyboard.press("Shift+End");
    await window.keyboard.press("ControlOrMeta+c");
    await endOf(window, 3);
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+v");
    const pasted = await saved(["Alpha", "Beta", "Gamma", "Alpha", "Alpha", "Beta"]);
    expect(new Set(keysOf(pasted)).size).toBe(6);
    expect(keysOf(pasted).slice(0, 3)).toEqual(KEYS);
    // "Beta" cut with its line break and pasted back at once: the same texts, but a new key.
    await caretIn(window, 1);
    await window.keyboard.press("Home");
    await window.keyboard.press("Shift+ArrowDown");
    await window.keyboard.press("ControlOrMeta+x");
    await window.keyboard.press("ControlOrMeta+v");
    const back = await saved(["Alpha", "Beta", "Gamma", "Alpha", "Alpha", "Beta"]);
    expect(back[1]?.key).not.toBe("kbbb");
    expect(new Set(keysOf(back)).size).toBe(6);
  });

  test("[SR-204/AK-gnnw] undo after a save brings back the keys, also after another buffer was shown", async () => {
    const { window } = running;
    // "Beta" deleted with its line break, and saved.
    await endOf(window, 1);
    await window.keyboard.press("Shift+Home");
    await window.keyboard.press("Backspace");
    await window.keyboard.press("Backspace");
    expect(keysOf(await saved(["Alpha", "Gamma"]))).toEqual(["kaaa", "kccc"]);
    await window.keyboard.press("ControlOrMeta+z");
    await window.keyboard.press("ControlOrMeta+z");
    expect(keysOf(await saved(["Alpha", "Beta", "Gamma"]))).toEqual(KEYS);
    // Merged and saved, another element shown, and back: undo still knows the keys.
    await caretIn(window, 1);
    await window.keyboard.press("Home");
    await window.keyboard.press("Backspace");
    expect(keysOf(await saved(["AlphaBeta", "Gamma"]))).toEqual(["kaaa", "kccc"]);
    // Escape leaves the box, and the box for the element.
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    await open(window, OTHER_TITLE);
    await open(window, SR_TITLE);
    await expect(criteriaBox(window).locator(".cm-lr-criterion-ref")).toHaveCount(2);
    await caretIn(window, 0);
    await window.keyboard.press("ControlOrMeta+z");
    expect(keysOf(await saved(["Alpha", "Beta", "Gamma"]))).toEqual(KEYS);
  });
});
