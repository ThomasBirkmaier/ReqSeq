// "Copy field" (SR-128) on the built app: the copy symbol of a field, the clipboard of the system, the
// confirmation in the modeline and the key. The tests keep the clipboard of the machine they run on:
// it is saved before each test and written back after it. Keys use ControlOrMeta, so the same tests run
// on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const SR_ID = "69069069-0000-4000-8000-0000000000b2";
const SR_TITLE = "Measure every second";
const CRITERIA = [
  "Given a second, when it is checked, then it holds.",
  "Given a **bold** word, when it is copied, then the marks stay.",
];
const TEXT = "b2: derives from N1, valid for V1, in P1 and P2.";

// The workspace of SR-069/filter with two acceptance criteria in this system requirement.
const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b2.md": `---
id: ${SR_ID}
type: system-requirement
status: draft
title: ${SR_TITLE}
requirement-type: performance
acceptance-criteria:
  - ${CRITERIA[0] ?? ""}
  - "${CRITERIA[1] ?? ""}"
topic: Timing
validity:
  - { id: 69069069-0000-4000-8000-0000000000c1, version: n1:1111111111111111 }
packages:
  - { id: 69069069-0000-4000-8000-0000000000d1, version: n1:1111111111111111 }
derives-from:
  - { id: 69069069-0000-4000-8000-0000000000a1, version: n1:1111111111111111 }
---

${TEXT}
`,
  },
};

const SENTINEL = "ReqSeq test sentinel";

const readClipboard = (running: RunningApp): Promise<string> =>
  running.app.evaluate(({ clipboard }) => clipboard.readText());
const writeClipboard = (running: RunningApp, text: string): Promise<void> =>
  running.app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);

const field = (window: Page, label: string): Locator => window.locator(`[data-field="${label}"]`);
const symbol = (window: Page, label: string): Locator => field(window, label).locator("> .copy");
const modeline = (window: Page): Locator => window.getByLabel("Modeline");

/** Opens the element with "Go to"; the buffer has the focus. */
const openElement = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(SR_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(SR_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(SR_TITLE);
  await expect(window.locator("article")).toBeFocused();
};

test.describe("copying a field of an element", () => {
  let running: RunningApp;
  let before: string;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    before = await readClipboard(running);
    await writeClipboard(running, SENTINEL);
    await openElement(running.window);
  });
  test.afterEach(async () => {
    await writeClipboard(running, before);
    await running.close();
  });

  /** The element as `element get` gives it: the stored text, and the ID the modeline names it by. */
  const stored = async (): Promise<{ readonly text: string; readonly id: string }> => {
    const result = await running.cli(["element", "get", SR_ID]);
    const { element } = JSON.parse(result.stdout) as {
      element: { identifier?: string; shortId: string; text: string };
    };
    return { text: element.text, id: element.identifier ?? element.shortId };
  };

  test("[SR-128/AK1] hovering a field shows its copy symbol, otherwise it is not to be seen", async () => {
    const { window } = running;
    // Title, text, a property box, a group of relations; the ID is in the modeline.
    const fields = ["Title", "Text", "acceptance-criteria", "topic", "derives-from"];
    await window.mouse.move(0, 0);
    for (const label of fields) {
      await expect(symbol(window, label), label).toBeHidden();
    }
    await expect(window.locator(".modeline .copy")).toBeHidden();
    for (const label of fields) {
      await field(window, label).hover();
      await expect(symbol(window, label), label).toBeVisible();
      // Only the field under the pointer shows its symbol.
      for (const other of fields.filter((candidate) => candidate !== label)) {
        await expect(symbol(window, other), `${other} while ${label}`).toBeHidden();
      }
    }
    await window.locator('.modeline [data-field="ID"]').hover();
    await expect(window.locator(".modeline .copy")).toBeVisible();
    await expect(symbol(window, "derives-from")).toBeHidden();
    // The symbol sits at the right edge of the field, inside the sheet.
    await field(window, "topic").hover();
    const box = await field(window, "topic").boundingBox();
    const mark = await symbol(window, "topic").boundingBox();
    expect(box).not.toBeNull();
    expect(mark).not.toBeNull();
    expect((mark?.x ?? 0) + (mark?.width ?? 0)).toBeCloseTo((box?.x ?? 0) + (box?.width ?? 0), 0);
    expect(mark?.width ?? 0).toBeGreaterThanOrEqual(20);
  });

  test("[SR-128/AK1] the focus in a field shows its copy symbol", async () => {
    const { window } = running;
    await window.mouse.move(0, 0);
    // A field that is a stop of the Tab key itself.
    for (const label of ["Title", "acceptance-criteria", "topic"]) {
      await field(window, label).focus();
      await expect(symbol(window, label), label).toBeVisible();
    }
    await field(window, "topic").blur();
    await expect(symbol(window, "topic")).toBeHidden();
    // The cursor in the text.
    await window.locator("article").focus();
    await window.keyboard.press("Enter");
    await expect(window.locator('[data-field="Text"] .cm-content')).toBeFocused();
    await expect(symbol(window, "Text")).toBeVisible();
    await expect(symbol(window, "Title")).toBeHidden();
    // A relation target, which is a link.
    await field(window, "derives-from").getByRole("link").first().focus();
    await expect(symbol(window, "derives-from")).toBeVisible();
    await expect(symbol(window, "Text")).toBeHidden();
  });

  test("[SR-128/AK2] clicking the symbol of a box pastes its values one per line, and the modeline says so for a moment", async () => {
    const { window } = running;
    await field(window, "acceptance-criteria").hover();
    await symbol(window, "acceptance-criteria").click();
    await expect(modeline(window)).toContainText("Copied acceptance-criteria");
    expect(await readClipboard(running)).toBe(CRITERIA.join("\n"));
    // Brief: the usual modeline is back after a few seconds.
    await expect(modeline(window)).not.toContainText("Copied", { timeout: 8000 });
  });

  test("[SR-128/AK2] copies the title, the text as it is stored, a relation group as shown, and the ID", async () => {
    const { window } = running;
    const copied = async (label: string, selector: Locator): Promise<string> => {
      await selector.hover();
      await symbol(window, label).click();
      await expect(modeline(window)).toContainText(`Copied ${label}`);
      return readClipboard(running);
    };
    expect(await copied("Title", field(window, "Title"))).toBe(SR_TITLE);
    expect(await copied("Text", field(window, "Text"))).toBe((await stored()).text);
    // A relation group copies its targets as their rows show them, one per line: the value of the field
    // (SR-128 AK2), without the hint after an outdated target (SR-110 AK2), which is about the reference.
    const rows = field(window, "derives-from").locator("li");
    const shown = (await rows.locator(":scope > :first-child").allInnerTexts()).map((line) => line.trim());
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toHaveLength(await rows.count());
    // The fixture's reference stores a version that is not the current one: the row shows the hint.
    await expect(rows.first().locator(".outdated")).toContainText("outdated");
    const group = await copied("derives-from", field(window, "derives-from"));
    expect(group).toBe(shown.join("\n"));
    expect(group).not.toContain("outdated");
    await window.locator('.modeline [data-field="ID"]').hover();
    await window.locator(".modeline .copy").click();
    await expect(modeline(window)).toContainText("Copied ID");
    expect(await readClipboard(running)).toBe((await stored()).id);
  });

  test("[SR-128/AK3] Ctrl/Cmd+Shift+C copies the field with the cursor; Copy field in the command prompt does too", async () => {
    const { window } = running;
    // The cursor in the text.
    await window.keyboard.press("Enter");
    await expect(window.locator('[data-field="Text"] .cm-content')).toBeFocused();
    await window.keyboard.press("ControlOrMeta+Shift+C");
    await expect(modeline(window)).toContainText("Copied Text");
    expect(await readClipboard(running)).toBe((await stored()).text);
    // The cursor in a box, and the command by its name: the prompt has the focus, the field is still meant.
    await writeClipboard(running, SENTINEL);
    await field(window, "acceptance-criteria").focus();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Copy field");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Copy field");
    await window.keyboard.press("Enter");
    await expect(modeline(window)).toContainText("Copied acceptance-criteria");
    expect(await readClipboard(running)).toBe(CRITERIA.join("\n"));
    // The cursor in no field: the ID.
    await window.locator("article").focus();
    await window.keyboard.press("ControlOrMeta+Shift+C");
    await expect(modeline(window)).toContainText("Copied ID");
    expect(await readClipboard(running)).toBe((await stored()).id);
  });

  test("[SR-128/AK3] with the caret in a box, Ctrl/Cmd+Shift+C copies what the box holds, the unsaved input included", async () => {
    const { window } = running;
    await writeClipboard(running, SENTINEL);
    const criteria = field(window, "acceptance-criteria");
    await criteria.locator(".cm-line").last().click();
    // The criterion can wrap once its source shows; Ctrl/Cmd+End goes to the end of the text, not of the visual line.
    await window.keyboard.press("ControlOrMeta+End");
    await window.keyboard.type(" Neu");
    // The copy symbol is not pressed: the key goes to the window with the caret still in the box.
    await window.keyboard.press("ControlOrMeta+Shift+C");
    await expect(modeline(window)).toContainText("Copied acceptance-criteria");
    expect(await readClipboard(running)).toBe([CRITERIA[0], `${CRITERIA[1] ?? ""} Neu`].join("\n"));
    await expect(criteria.locator(".cm-content")).toBeFocused();
    // Copying changes nothing: the input is saved like any input (SR-105), and the file then holds what
    // was copied.
    await expect(modeline(window)).not.toContainText("modified");
    const got = JSON.parse((await running.cli(["element", "get", SR_ID])).stdout) as {
      element: { properties: Record<string, unknown> };
    };
    expect(got.element.properties["acceptance-criteria"]).toEqual([CRITERIA[0], `${CRITERIA[1] ?? ""} Neu`]);
  });

  test("[SR-128/AK4] a click on a field only sets the cursor: the clipboard is not changed", async () => {
    const { window } = running;
    await field(window, "Title").click();
    await field(window, "acceptance-criteria").click();
    await field(window, "derives-from").getByRole("link").first().hover();
    await window.locator('[data-field="Text"] .cm-content').click();
    await expect(window.locator('[data-field="Text"] .cm-content')).toBeFocused();
    await window.keyboard.type("x");
    await window.locator(".modeline [data-field='ID'] span").first().click();
    expect(await readClipboard(running)).toBe(SENTINEL);
    await expect(modeline(window)).not.toContainText("Copied");
  });

  test("screenshot: the copy symbol on a focused field of a system requirement", async () => {
    const { window } = running;
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await window.mouse.move(0, 0);
    await field(window, "acceptance-criteria").focus();
    await expect(symbol(window, "acceptance-criteria")).toBeVisible();
    await window.screenshot({ path: path.join(OUT, "copy-field.png") });
  });
});
