// The field the focus is in (SR-155) on the built app: it has the background of the selected row of a
// list, the tint and the copy symbol move with the arrow keys, and no field is tinted while the focus is
// on the buffer or in the prompt.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SR_TITLE = "Measure every second";

// The workspace of SR-069/filter with two acceptance criteria in this system requirement.
const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b2.md": `---
id: 69069069-0000-4000-8000-0000000000b2
type: system-requirement
status: draft
title: ${SR_TITLE}
requirement-type: performance
acceptance-criteria:
  - Given a second, when it is checked, then it holds.
topic: Timing
derives-from:
  - { id: 69069069-0000-4000-8000-0000000000a1, version: n1:1111111111111111 }
---

One line of text.
`,
  },
};

const FIELDS = ["Title", "Text", "requirement-type", "acceptance-criteria", "topic", "derives-from"];

const field = (window: Page, label: string): Locator => window.locator(`article [data-field="${label}"]`);
const symbol = (window: Page, label: string): Locator => field(window, label).locator("> .copy");

/** The background of a field as the page draws it. */
const background = (window: Page, label: string): Promise<string> =>
  field(window, label).evaluate((node) => getComputedStyle(node).backgroundColor);

/** The colour of a selected row of a list (`--select`), as the page draws it. */
const selectedRow = (window: Page): Promise<string> =>
  window.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "row";
    probe.setAttribute("aria-selected", "true");
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });

/** The labels of the fields that are tinted now. */
const tinted = async (window: Page): Promise<string[]> => {
  const clear = await field(window, "topic").evaluate(() => {
    const probe = document.createElement("div");
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  const shown: string[] = [];
  for (const label of FIELDS) {
    if ((await background(window, label)) !== clear) {
      shown.push(label);
    }
  }
  return shown;
};

/** How many fields of all areas are tinted now. */
const tintedAnywhere = (window: Page): Promise<number> =>
  window.evaluate(() => {
    const probe = document.createElement("div");
    document.body.append(probe);
    const clear = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll("article .field")].filter(
      (node) => getComputedStyle(node).backgroundColor !== clear,
    ).length;
  });

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
};

test.describe("the field the focus is in", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(SR_TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(SR_TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(SR_TITLE);
    await expect(window.locator("article")).toBeFocused();
    await window.mouse.move(0, 0);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-155/AK1] has the background of the selected row of a list, and no other field has it", async () => {
    const { window } = running;
    const row = await selectedRow(window);
    for (const label of ["Title", "topic", "derives-from"]) {
      const target =
        label === "derives-from" ? field(window, label).getByRole("link").first() : field(window, label);
      await target.focus();
      await expect.poll(() => background(window, label), label).toBe(row);
      await expect.poll(() => tinted(window), label).toEqual([label]);
    }
    // The cursor in the text: the text is the field.
    await window.locator("article").focus();
    await window.keyboard.press("Enter");
    await expect(window.locator('[data-field="Text"] .cm-content')).toBeFocused();
    await expect.poll(() => tinted(window)).toEqual(["Text"]);
  });

  test("[SR-155/AK2] the tint and the copy symbol move with the arrow keys, the pointer elsewhere", async () => {
    const { window } = running;
    // The first box below the text, in the order the boxes are shown.
    const labels = await window
      .locator("article [data-field]")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset["field"] ?? ""));
    const box = labels.find((label) => label !== "Title" && label !== "Text") ?? "";
    expect(box).not.toBe("");
    const at = async (label: string): Promise<void> => {
      await expect.poll(() => tinted(window), label).toEqual([label]);
      await expect(symbol(window, label), label).toBeVisible();
      for (const other of ["Title", "Text", box].filter((candidate) => candidate !== label)) {
        await expect(symbol(window, other), `${other} while ${label}`).toBeHidden();
      }
    };
    // Down on the element itself goes to its first field (assumption, product owner to confirm).
    await window.keyboard.press("ArrowDown");
    await expect(field(window, "Title")).toBeFocused();
    await at("Title");
    await window.keyboard.press("ArrowDown");
    await at("Text");
    // Down goes through the lines of the text, and from its last line into the box.
    await expect
      .poll(async () => {
        await window.keyboard.press("ArrowDown");
        return tinted(window);
      })
      .toEqual([box]);
    await at(box);
    await window.keyboard.press("ArrowUp");
    await at("Text");
  });

  test("[SR-155/AK3] no field is tinted while the focus is on the buffer or in the prompt", async () => {
    const { window } = running;
    expect(await tinted(window)).toEqual([]);
    await field(window, "topic").focus();
    await expect.poll(() => tinted(window)).toEqual(["topic"]);
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
    await expect.poll(() => tinted(window)).toEqual([]);
    await field(window, "topic").focus();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(window.locator("#prompt-input")).toBeFocused();
    await expect.poll(() => tinted(window)).toEqual([]);
    await window.keyboard.press("Escape");
    // The other area of a split window: no field of either area is tinted.
    await field(window, "topic").focus();
    await command(window, "Split window");
    await expect(window.locator('[data-area="right"]')).toBeVisible();
    await field(window, "topic").first().focus();
    await expect.poll(() => tintedAnywhere(window)).toBe(1);
    await command(window, "Other window");
    await expect(window.locator("article [data-field]:focus-within")).toHaveCount(0);
    await expect.poll(() => tintedAnywhere(window)).toBe(0);
  });
});
