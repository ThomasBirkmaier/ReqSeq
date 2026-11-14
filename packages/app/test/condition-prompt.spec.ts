// A condition and a sort built step by step from hits in the command prompt, on the built app (SR-215 AK3, AK4,
// AK5, AK6, AK7, AK9, AK10, SR-134 AK4, SR-210 AK2): "Save filter" asks its `where` as kinds and their values,
// each chosen condition a mark in the input; Backspace and the × of a mark remove it; text that starts with "{"
// is one condition in JSON; the finishing hit saves the file the command line writes for the same input. On a
// filtered list, "Save perspective" takes the list's conditions with Enter, Enter, on a sorted list its sort,
// each key then "Order", and on a grouped list its grouping (AK1, AK5), as "Save list as perspective" does. The
// light screenshots go to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS). Keys use
// ControlOrMeta, so the same test runs on Linux, macOS and Windows.
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const mac = process.platform === "darwin";
const MORE = mac ? "⌘↩" : "Ctrl+Enter";
const ENTER = mac ? "↩" : "Enter";

const label = (window: Page) => window.locator("label.prompt-label");
const marked = (window: Page) => window.locator('.candidates [aria-selected="true"] .name');
const marks = (window: Page) => window.getByRole("list", { name: "Marks" }).getByRole("listitem");

/** Types `text` and takes the hit it marks, which must be `name`. */
const pick = async (window: Page, text: string, name: string): Promise<void> => {
  await window.keyboard.type(text);
  await expect(marked(window)).toHaveText(name);
  await window.keyboard.press("Enter");
};

test.describe("a condition built from hits in the command prompt (SR-215)", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-069/filter" }, { colorScheme: "light" });
    await expect(running.window.getByRole("listbox", { name: "Overview" })).toBeVisible();
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-215/AK-dt5s] [SR-215/AK-rx2z] [SR-134/AK-fmf6] [SR-215/AK-hnzf] Save filter builds its condition from marks, Backspace and × remove them, and the file is the one the command line writes", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Save filter", "Save filter");
    await window.keyboard.type("Drafts");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Save filter Drafts · where:");
    // Without a mark the finishing hit is marked (AK4).
    await expect(marked(window)).toHaveText("No condition: all elements");
    await pick(window, "Type", "Type");
    await expect(label(window)).toHaveText("Save filter Drafts · where · Type:");
    await pick(window, "System Requirement", "System Requirement");
    await pick(window, "Status", "Status");
    await pick(window, "Draft", "Draft");
    await expect(marks(window)).toHaveText(["type: system-requirement×", "status: draft×"]);
    await expect(marked(window)).toHaveText("Take 2 conditions");
    await expect(window.getByRole("note", { name: "Explanation" }).locator(".explain-keys")).toHaveText(
      `${ENTER} takes the marked hit; all conditions must hold · Backspace on an empty input removes the last mark · { a condition in JSON · ${MORE} more arguments · Escape back`,
    );
    await window.screenshot({ path: path.join(SHOTS, "sr-215-condition-light.png") });
    // Marks that fill a narrow line cut their labels with "…"; each × and the input stay visible.
    await window.setViewportSize({ width: 520, height: 700 });
    await pick(window, "Text search", "Text search");
    await window.keyboard.type("performance thresholds of the weather station");
    await window.keyboard.press("Enter");
    await expect(marks(window)).toHaveCount(3);
    const boxes = await window.evaluate(() =>
      [...document.querySelectorAll(".prompt-mark")].map((mark) => {
        const outer = mark.getBoundingClientRect();
        const unmark = mark.querySelector(".prompt-unmark")?.getBoundingClientRect();
        const label = mark.querySelector(".prompt-mark-label");
        return {
          inside:
            unmark !== undefined &&
            unmark.width > 0 &&
            unmark.left >= outer.left &&
            unmark.right <= outer.right + 0.5 &&
            unmark.right <= globalThis.innerWidth,
          cut: label !== null && label.scrollWidth > label.clientWidth,
        };
      }),
    );
    expect(boxes.every((box) => box.inside)).toBe(true);
    expect(boxes.some((box) => box.cut)).toBe(true);
    const input = await window
      .locator("#prompt-input")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(input).toBeGreaterThan(60);
    await window.keyboard.press("Backspace");
    await expect(marks(window)).toHaveCount(2);
    // Backspace on the empty input removes the last mark; the × of a mark removes that one.
    await window.keyboard.press("Backspace");
    await expect(marks(window)).toHaveText(["type: system-requirement×"]);
    await pick(window, "Status", "Status");
    await pick(window, "Draft", "Draft");
    await window.getByRole("button", { name: "Remove type: system-requirement" }).click();
    await expect(marks(window)).toHaveText(["status: draft×"]);
    await expect(window.locator("#prompt-input")).toBeFocused();
    // Text that starts with "{" is one condition in JSON.
    await pick(window, '{"not":{"type":["decision"]}}', "Add the condition in JSON");
    await expect(marks(window)).toHaveText(["status: draft×", '{"not":{"type":["decision"]}}×']);
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    const saved = async (): Promise<string> => {
      const listed = await running.cli(["filter", "list"]);
      const file = (JSON.parse(listed.stdout) as { filters: { name: string; file: string }[] }).filters.find(
        (filter) => filter.name === "Drafts",
      )?.file;
      return file === undefined ? "" : fsp.readFile(path.join(running.workspace?.root ?? "", file), "utf8");
    };
    await expect.poll(saved).toContain("draft");
    const fromApp = await saved();
    // The command line with the same input writes the same file (AK10).
    const cli = await running.cli([
      "filter",
      "save",
      "Drafts",
      "--where",
      JSON.stringify({ all: [{ status: ["draft"] }, { not: { type: ["decision"] } }] }),
    ]);
    expect(cli.code).toBe(0);
    expect(await saved()).toBe(fromApp);
  });

  test("[SR-215/AK-w8q6] on a filtered list Save perspective takes the list's conditions with Enter, Enter: the selection Save list as perspective saves", async () => {
    const { window } = running;
    /** Runs the command prompt's `title`, then answers `prompt` with `value`, the hit it marks. */
    const filtered = async (title: string, prompt: string, value: string, hit: string): Promise<void> => {
      await window.keyboard.press("ControlOrMeta+Shift+P");
      await pick(window, title, title);
      await expect(label(window)).toHaveText(prompt);
      await window.keyboard.type(value);
      if (hit !== "") {
        await expect(marked(window)).toHaveText(hit);
      }
      await window.keyboard.press("Enter");
    };
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "List all elements", "List all elements");
    await filtered("Filter list by type", "Type", "system-requirement", "system-requirement");
    await filtered("Filter list by text search", "Text", "measure", "");
    await expect(window.locator('[aria-label="Sheet"] [data-buffer]')).toHaveAttribute(
      "aria-label",
      "type: system-requirement · text: measure",
    );
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Save perspective", "Save perspective");
    await window.keyboard.type("Mine");
    await window.keyboard.press("Enter");
    await expect(marked(window)).toHaveText("Conditions of the shown list");
    await window.screenshot({ path: path.join(SHOTS, "sr-215-shown-list-light.png") });
    await window.keyboard.press("Enter");
    await expect(marks(window)).toHaveText(["type: system-requirement×", "text: measure×"]);
    await expect(marked(window)).toHaveText("Take 2 conditions");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Save list as perspective", "Save list as perspective");
    await window.locator("#prompt-input").fill("Theirs");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    const selection = async (name: string): Promise<unknown> => {
      const listed = await running.cli(["perspective", "list"]);
      const found = (
        JSON.parse(listed.stdout) as { perspectives: { name: string; where?: unknown; filter?: unknown }[] }
      ).perspectives.find((perspective) => perspective.name === name);
      return found === undefined ? undefined : { where: found.where, filter: found.filter };
    };
    await expect.poll(() => selection("Theirs")).toBeDefined();
    expect(await selection("Mine")).toEqual({
      where: { all: [{ type: ["system-requirement"] }, { text: "measure" }] },
    });
    expect(await selection("Theirs")).toEqual(await selection("Mine"));
  });

  test("[SR-215/AK-q4fs] [SR-215/AK-w8q6] [SR-215/AK-fm4s] [SR-215/AK-rx2z] [SR-134/AK-fmf6] [SR-210/AK-t8sc] [SR-215/AK-hnzf] on a sorted list Save perspective takes the list's sort as marks, a key asks Order, and the file is the one the command line writes", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "List all elements", "List all elements");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Sort list", "Sort list");
    await pick(window, "Title", "Title");
    await pick(window, "descending", "descending");
    await expect(window.getByLabel("Modeline")).toContainText("sorted by title descending");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Save perspective", "Save perspective");
    await window.keyboard.type("Sorted");
    await window.keyboard.press("Enter");
    await expect(marked(window)).toHaveText("No condition: all elements");
    await window.keyboard.press("ControlOrMeta+Enter");
    await pick(window, "sort", "sort");
    await expect(label(window)).toHaveText("Save perspective Sorted all elements · sort:");
    // Without a mark the sort of the shown list is the first hit (AK5).
    await expect(marked(window)).toHaveText("Sort of the shown list");
    await window.keyboard.press("Enter");
    await expect(marks(window)).toHaveText(["Title descending×"]);
    await expect(marked(window)).toHaveText("Take 1 sort key");
    await expect(window.getByRole("note", { name: "Explanation" }).locator(".explain-keys")).toHaveText(
      `${ENTER} takes the marked hit; the keys sort in their order · Backspace on an empty input removes the last mark · ${MORE} more arguments · Escape back`,
    );
    // A key asks "Order", then is a mark with its direction (AK7).
    await pick(window, "Status", "Status");
    await expect(label(window)).toHaveText("Save perspective Sorted all elements · sort · Status · Order:");
    await pick(window, "descending", "descending");
    await expect(marks(window)).toHaveText(["Title descending×", "Status descending×"]);
    await window.screenshot({ path: path.join(SHOTS, "sr-215-sort-light.png") });
    // Backspace on the empty input removes the last mark.
    await window.keyboard.press("Backspace");
    await expect(marks(window)).toHaveText(["Title descending×"]);
    await pick(window, "ID", "ID");
    await pick(window, "ascending", "ascending");
    await expect(marks(window)).toHaveText(["Title descending×", "ID ascending×"]);
    await window.keyboard.press("Enter");
    await expect(marked(window)).toHaveText("Run");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    const saved = async (name: string): Promise<string> => {
      const listed = await running.cli(["perspective", "list"]);
      const file = (
        JSON.parse(listed.stdout) as { perspectives: { name: string; file: string }[] }
      ).perspectives.find((perspective) => perspective.name === name)?.file;
      return file === undefined ? "" : fsp.readFile(path.join(running.workspace?.root ?? "", file), "utf8");
    };
    await expect.poll(() => saved("Sorted")).toContain("identifier");
    const fromApp = await saved("Sorted");
    // The command line with the same input writes the same file (AK10).
    const cli = await running.cli([
      "perspective",
      "save",
      "Sorted",
      "--where",
      JSON.stringify({ all: [] }),
      "--sort",
      "title:desc",
      "--sort",
      "identifier:asc",
    ]);
    expect(cli.code).toBe(0);
    expect(await saved("Sorted")).toBe(fromApp);
  });

  test("[SR-215/AK-fj75] [SR-215/AK-w8q6] on a grouped list Save perspective offers the groupings by name with the key beside, the list's first, and the file is the one the command line writes", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "List all elements", "List all elements");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Group list", "Group list");
    // The groupings come with the facets of the list.
    await expect(marked(window)).toHaveText("Type");
    await pick(window, "Status", "Status");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "Save perspective", "Save perspective");
    await window.keyboard.type("Grouped");
    await window.keyboard.press("Enter");
    await expect(marked(window)).toHaveText("No condition: all elements");
    await window.keyboard.press("ControlOrMeta+Enter");
    await pick(window, "group", "group");
    await expect(label(window)).toHaveText("Save perspective Grouped all elements · group:");
    // The grouping of the shown list is the first hit (AK5), then the groupings, each with its key (AK1).
    await expect(marked(window)).toHaveText("Grouping of the shown list");
    const hit = (name: string) =>
      window.locator('.candidates [role="option"]').filter({ has: window.getByText(name, { exact: true }) });
    await expect(hit("Grouping of the shown list").locator(".hint")).toHaveText("Status");
    await expect(hit("Type").locator(".hint")).toHaveText("type");
    await window.screenshot({ path: path.join(SHOTS, "sr-215-group-light.png") });
    await window.keyboard.press("Enter");
    await expect(marked(window)).toHaveText("Run");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    const saved = async (name: string): Promise<string> => {
      const listed = await running.cli(["perspective", "list"]);
      const file = (
        JSON.parse(listed.stdout) as { perspectives: { name: string; file: string }[] }
      ).perspectives.find((perspective) => perspective.name === name)?.file;
      return file === undefined ? "" : fsp.readFile(path.join(running.workspace?.root ?? "", file), "utf8");
    };
    await expect.poll(() => saved("Grouped")).toContain("status");
    const fromApp = await saved("Grouped");
    const cli = await running.cli([
      "perspective",
      "save",
      "Grouped",
      "--where",
      JSON.stringify({ all: [] }),
      "--group",
      "status",
    ]);
    expect(cli.code).toBe(0);
    expect(await saved("Grouped")).toBe(fromApp);
  });
});
