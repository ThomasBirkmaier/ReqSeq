// A condition, a grouping and a sort built step by step from hits in the command prompt, on the built app
// (SR-215 AK1, AK3, AK4, AK6, AK7, AK9, AK10, SR-219 AK2, AK3, AK4, AK6, AK7, SR-134 AK4, SR-210 AK2): "New
// saved filter" asks its `where` as kinds and their values, each chosen condition a mark in the input;
// Backspace and the × of a mark remove it; text that starts with "{" is one condition in JSON; "Next: sort"
// goes on and "Save" saves the file the command line writes for the same input. "New perspective" asks the
// condition, the grouping and the sort in turn, each key then "Order", shows the marks of the steps before,
// and after "Save" opens the perspective. The light screenshots go to `test-results/electron/screenshots/`
// (or the folder in REQSEQ_SCREENSHOTS). Keys use ControlOrMeta, so the same test runs on Linux, macOS and
// Windows.
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

  test("[SR-215/AK-dt5s] [SR-215/AK-rx2z] [SR-134/AK-fmf6] [SR-215/AK-hnzf] [SR-219/AK-kv63] New saved filter builds its condition from marks, Backspace and × remove them, Next: sort and Save save the file the command line writes", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "New saved filter", "New saved filter");
    await window.keyboard.type("Drafts");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("New saved filter Drafts · where:");
    // Without a mark the finishing hit is marked (AK4).
    await expect(marked(window)).toHaveText("No condition: all elements");
    await pick(window, "Type", "Type");
    await expect(label(window)).toHaveText("New saved filter Drafts · where · Type:");
    await pick(window, "System Requirement", "System Requirement");
    await pick(window, "", "Take 1 type");
    await pick(window, "Status", "Status");
    await pick(window, "Draft", "Draft");
    await expect(marks(window)).toHaveText(["type: system-requirement×", "status: draft×"]);
    await expect(marked(window)).toHaveText("Next: sort");
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
    // The sort, the last step of a saved filter: "Save" without a key saves no sort (SR-219 AK3).
    await expect(label(window)).toHaveText("New saved filter Drafts · sort:");
    await expect(marked(window)).toHaveText("Save");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    await expect(window.locator(".minibuffer .echo")).toHaveText("Saved filter Drafts");
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

  test("[SR-215/AK-w8q6] several types go into one type mark that keeps the elements of one of them; Type continues it, Escape and Backspace keep it", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    const hits = window.locator('.candidates [role="option"] .name');
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "New saved filter", "New saved filter");
    await window.keyboard.type("Needs and decisions");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("New saved filter Needs and decisions · where:");
    await pick(window, "Type", "Type");
    // A chosen type goes into the mark and the step stays, "Take 1 type" first and marked.
    await pick(window, "Need", "Need");
    await expect(label(window)).toHaveText("New saved filter Needs and decisions · where · Type:");
    await expect(marks(window)).toHaveText(["type: need×"]);
    await expect(marked(window)).toHaveText("Take 1 type");
    await pick(window, "Decision", "Decision");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    await expect(marked(window)).toHaveText("Take 2 types");
    // The chosen types are no longer offered.
    await expect(hits.filter({ hasText: /^(Need|Decision)$/ })).toHaveCount(0);
    await expect(hits.filter({ hasText: /^System Requirement$/ })).toHaveCount(1);
    await window.screenshot({ path: path.join(SHOTS, "sr-215-type-mark-light.png") });
    // Escape goes back to the kinds; the mark stays.
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("New saved filter Needs and decisions · where:");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    // Type again continues the mark; Backspace on the empty input goes back to the kinds and keeps it.
    await pick(window, "Type", "Type");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    await expect(marked(window)).toHaveText("Take 2 types");
    await window.keyboard.press("Backspace");
    await expect(label(window)).toHaveText("New saved filter Needs and decisions · where:");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    await window.screenshot({ path: path.join(SHOTS, "sr-215-type-mark-kinds-light.png") });
    await pick(window, "", "Next: sort");
    await pick(window, "", "Save");
    await expect(window.locator(".minibuffer .echo")).toHaveText("Saved filter Needs and decisions");
    // The saved filter keeps the elements of one of the types: the two needs and the decision.
    await expect
      .poll(async () => {
        const listed = await running.cli(["element", "list", "--filter", "Needs and decisions"]);
        return (JSON.parse(listed.stdout) as { elements?: { type: string }[] }).elements
          ?.map((element) => element.type)
          .sort();
      })
      .toEqual(["decision", "need", "need"]);
  });

  test("[SR-215/AK-q4fs] [SR-215/AK-fm4s] [SR-215/AK-rx2z] [SR-134/AK-fmf6] [SR-210/AK-t8sc] [SR-215/AK-hnzf] New perspective asks the sort last, a key asks Order, and the file is the one the command line writes", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "List all elements", "List all elements");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "New perspective", "New perspective");
    await window.keyboard.type("Sorted");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("New perspective Sorted · where:");
    await pick(window, "", "No condition: all elements");
    await pick(window, "", "No grouping");
    await expect(label(window)).toHaveText("New perspective Sorted · sort:");
    // Without a mark "Save" is the first hit (AK4, SR-219 AK2).
    await expect(marked(window)).toHaveText("Save");
    await pick(window, "Title", "Title");
    await pick(window, "descending", "descending");
    await expect(marks(window)).toHaveText(["Title descending×"]);
    await expect(marked(window)).toHaveText("Save");
    await expect(window.getByRole("note", { name: "Explanation" }).locator(".explain-keys")).toHaveText(
      `${ENTER} takes the marked hit; Save saves with the keys in their order · Backspace on an empty input removes the last mark · ${MORE} more arguments · Escape back`,
    );
    // A key asks "Order", then is a mark with its direction (AK7).
    await pick(window, "Status", "Status");
    await expect(label(window)).toHaveText("New perspective Sorted · sort · Status · Order:");
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

  test("[SR-215/AK-fj75] [SR-219/AK-tbwz] [SR-219/AK-pqry] [SR-219/AK-k5p2] [SR-219/AK-vnsd] New perspective asks name, condition, grouping and sort in turn with the marks before, opens the perspective after Save, and the file is the one the command line writes", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    const hit = (name: string) =>
      window.locator('.candidates [role="option"]').filter({ has: window.getByText(name, { exact: true }) });
    const explain = window.getByRole("note", { name: "Explanation" }).locator(".explain-keys");
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "New perspective", "New perspective");
    await expect(label(window)).toHaveText("New perspective · name:");
    await window.keyboard.type("Grouped");
    await window.screenshot({ path: path.join(SHOTS, "sr-219-name-light.png") });
    await window.keyboard.press("Enter");
    // The condition, without a mark and without a hit for the shown list.
    await expect(label(window)).toHaveText("New perspective Grouped · where:");
    await expect(marked(window)).toHaveText("No condition: all elements");
    await pick(window, "Type", "Type");
    await pick(window, "System Requirement", "System Requirement");
    await pick(window, "", "Take 1 type");
    await expect(marked(window)).toHaveText("Next: grouping");
    await window.screenshot({ path: path.join(SHOTS, "sr-219-where-light.png") });
    await window.keyboard.press("Enter");
    // The grouping: "No grouping" first, then the groupings by name with the key beside (SR-215 AK1).
    await expect(label(window)).toHaveText("New perspective Grouped · group:");
    await expect(marked(window)).toHaveText("No grouping");
    await expect(hit("Type").locator(".hint")).toHaveText("type");
    await expect(hit("Status").locator(".hint")).toHaveText("status");
    // The marks of the step before stand first, without × (SR-219 AK6).
    await expect(marks(window)).toHaveText(["type: system-requirement"]);
    await expect(window.locator(".prompt-unmark")).toHaveCount(0);
    await window.screenshot({ path: path.join(SHOTS, "sr-219-group-light.png") });
    await pick(window, "Status", "Status");
    // The sort: "Save" first, the condition and the grouping as marks before.
    await expect(label(window)).toHaveText("New perspective Grouped · sort:");
    await expect(marked(window)).toHaveText("Save");
    await expect(marks(window)).toHaveText(["type: system-requirement", "grouped by Status"]);
    // Escape goes back to the grouping, whose answer stands first and marked: Enter keeps it (SR-219 AK6).
    await window.keyboard.press("Escape");
    await expect(label(window)).toHaveText("New perspective Grouped · group:");
    await expect(marked(window)).toHaveText("Status");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("New perspective Grouped · sort:");
    await expect(marks(window)).toHaveText(["type: system-requirement", "grouped by Status"]);
    await window.screenshot({ path: path.join(SHOTS, "sr-219-sort-light.png") });
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveCount(0);
    // After Save the perspective is open as saved, and the echo says so (SR-219 AK7).
    await expect(window.locator(".minibuffer .echo")).toHaveText("Saved perspective Grouped");
    await expect(window.getByLabel("Modeline")).toContainText("perspective: Grouped · grouped by status");
    // The name of a saved perspective says what it replaces (SR-219 AK4).
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await pick(window, "New perspective", "New perspective");
    await window.keyboard.type("Grouped");
    await expect(explain).toContainText("Replaces the perspective Grouped · ");
    await window.screenshot({ path: path.join(SHOTS, "sr-219-replaces-light.png") });
    await window.keyboard.press("Escape");
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
      JSON.stringify({ all: [{ type: ["system-requirement"] }] }),
      "--group",
      "status",
      "--sort",
      "type:asc",
      "--sort",
      "identifier:asc",
    ]);
    expect(cli.code).toBe(0);
    expect(await saved("Grouped")).toBe(fromApp);
  });
});
