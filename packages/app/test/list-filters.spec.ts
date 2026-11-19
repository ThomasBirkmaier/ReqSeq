// Cascading list filters (SR-124, ThomasBirkmaier/ReqSeq-archive#425) on the built app: each "Filter list" narrows the list
// the one before gave, and what the list shows is compared with what the CLI gives for the same
// selection (SR-080). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll, modifier } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const P = "69069069-0000-4000-8000-0000000000";
/** The filter fixture plus two more draft requirements in the package Sensors, on the topics Timing and Wind, so that the topics are shared and the last step narrows. */
const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: ${P}b6\ntype: system-requirement\nstatus: draft\ntitle: Measure the rain\nrequirement-type: functional\nacceptance-criteria:\n  - Given rain, when it is checked, then it holds.\ntopic: Timing\npackages:\n  - { id: ${P}d1, version: n1:1111111111111111 }\n---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: ${P}b7\ntype: system-requirement\nstatus: draft\ntitle: Measure the hail\nrequirement-type: functional\nacceptance-criteria:\n  - Given hail, when it is checked, then it holds.\ntopic: Wind\npackages:\n  - { id: ${P}d1, version: n1:1111111111111111 }\n---\n`,
  },
};

interface Listed {
  readonly elements: readonly { readonly title: string }[];
  readonly total: number;
}

const rowTitles = (window: Page): Promise<string[]> => window.locator(".row .title").allTextContents();

/** Opens the command prompt, types `command` and runs the first candidate. */
const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

/** Types `text` into the prompt `label` once it is asked for (the choices come from a command) and presses Enter. */
const answer = async (window: Page, label: string, text: string): Promise<void> => {
  await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText(label);
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
};

const marked = (window: Page) => window.locator('.candidates [aria-selected="true"] .name');
const marks = (window: Page) => window.getByRole("list", { name: "Marks" }).getByRole("listitem");

/** Takes the type mark with "Take <n> types", the first hit once one is chosen (SR-124 AK7). */
const takeTypes = async (window: Page, name: string): Promise<void> => {
  await expect(marked(window)).toHaveText(name);
  await window.keyboard.press("Enter");
};

/** "Filter list" with the kind `kind` (SR-124 AK5). */
const filterList = async (window: Page, kind: string): Promise<void> => {
  await runCommand(window, "Filter list");
  await answer(window, "Filter by", kind);
};

const listedBy = async (running: RunningApp, where: unknown): Promise<Listed> => {
  const result = await running.cli([
    "element",
    "list",
    "--input",
    JSON.stringify({ selection: { where }, sort: DEFAULT_SORT }),
  ]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Listed;
};

const PACKAGE = { property: "packages", op: "eq", value: "PKG-0000d1" };
const TYPE = { type: ["system-requirement"] };
const STATUS = { status: ["draft"] };
const TOPIC = { property: "topic", op: "eq", value: "Timing" };

test.describe("cascading list filters on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE, { colorScheme: "light" });
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** Package, type, status and property by keyboard (the example of SR-124 AK1); "Filter list" is typed as its initials once. */
  const cascade = async (): Promise<void> => {
    const { window } = running;
    await runCommand(window, "fl");
    await answer(window, "Filter by", "Property");
    await answer(window, "Property", "Package");
    await answer(window, "Package", "Sensors");
    await filterList(window, "Type");
    await answer(window, "Type", "System Requirement");
    await takeTypes(window, "Take 1 type");
    await filterList(window, "Status");
    await answer(window, "Status", "draft");
    await filterList(window, "Property");
    await answer(window, "Property", "Topic");
    await answer(window, "Topic", "Timing");
  };

  test("[SR-124/AK-jz48] package, type, status and property by keyboard give the list of the CLI for all four conditions", async () => {
    await cascade();
    const listed = await listedBy(running, { all: [PACKAGE, TYPE, STATUS, TOPIC] });
    await expect(running.window.getByLabel("Modeline")).toContainText(
      "packages: Sensors · type: system-requirement · status: draft · topic: Timing",
    );
    await expect(running.window.getByLabel("Modeline")).toContainText(`${String(listed.total)} elements`);
    expect(listed.total).toBe(2);
    expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
  });

  test("[SR-124/AK-jz48] clear list filter removes only the last step", async () => {
    await cascade();
    await runCommand(running.window, "clear list filter");
    const listed = await listedBy(running, { all: [PACKAGE, TYPE, STATUS] });
    await expect(running.window.getByLabel("Modeline")).toContainText(
      "type: system-requirement · status: draft",
    );
    await expect(running.window.getByLabel("Modeline")).not.toContainText("topic");
    expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
    expect(listed.total).toBeGreaterThan(2);
  });

  test("[SR-124/AK-hxcz] the property prompt offers topic, not the acceptance criteria nor the status", async () => {
    const { window } = running;
    await filterList(window, "Type");
    await answer(window, "Type", "System Requirement");
    await takeTypes(window, "Take 1 type");
    await filterList(window, "Property");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Property");
    const names = await window.locator('.candidates [role="option"] .name').allTextContents();
    // By display name, as the metamodel names them; the status is a kind of its own (SR-124 AK2).
    expect(names).toContain("Topic");
    expect(names).not.toContain("Status");
    expect(names).toContain("Requirement Type");
    expect(names).not.toContain("Acceptance Criteria");
    expect(names).not.toContain("Title");
    await window.keyboard.press("Escape");
  });

  test("[SR-124/AK-mch4] a text search narrows the current list", async () => {
    const { window } = running;
    await filterList(window, "Type");
    await answer(window, "Type", "System Requirement");
    await takeTypes(window, "Take 1 type");
    await filterList(window, "Text search");
    await answer(window, "Text", "icing");
    const result = await running.cli([
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { all: [TYPE, { text: "icing" }] } }, sort: DEFAULT_SORT }),
    ]);
    const listed = JSON.parse(result.stdout) as Listed;
    await expect(window.getByLabel("Modeline")).toContainText("type: system-requirement · text: icing");
    expect(await rowTitles(window)).toEqual(listed.elements.map((e) => e.title));
    expect(listed.elements.map((e) => e.title)).toContain("Survive icing");
  });

  test("[SR-124/AK-zmfp] [SR-124/AK-y24h] Filter list asks the kind first, one value adds one step, and Escape goes back a step", async () => {
    const { window } = running;
    const label = window.getByLabel("Minibuffer").locator("label");
    const names = window.locator('.candidates [role="option"] .name');
    await runCommand(window, "Filter list");
    await expect(label).toHaveText("Filter by");
    await expect(names).toHaveText([
      "Type",
      "Status",
      "Property",
      "Verification status",
      "Validation status",
      "Validity",
      "Relation",
      "Text search",
      "Saved filter",
    ]);
    await fs.mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: path.join(SHOTS, "sr-124-filter-kinds-light.png") });
    // Escape: from the values to the kind, from the kind to the command list it was chosen in.
    await answer(window, "Filter by", "Status");
    await expect(label).toHaveText("Status");
    await expect(names).toHaveText(["Draft", "Approved", "Obsolete"]);
    await window.keyboard.press("Escape");
    await expect(label).toHaveText("Filter by");
    await window.keyboard.press("Escape");
    await expect(label).toHaveText("Command");
    await window.keyboard.press("Escape");
    await expect(label).toHaveCount(0);
    await expect(window.getByLabel("Modeline")).toContainText("All elements");
    // By Ctrl/Cmd+K F: one value, one step more, labelled with kind and value.
    await window.keyboard.press(`${await modifier(window)}+K`);
    await window.keyboard.press("f");
    await answer(window, "Filter by", "Status");
    await answer(window, "Status", "Draft");
    await expect(window.getByLabel("Modeline")).toContainText("status: draft");
    await expect(label).toHaveCount(0);
    const listed = await listedBy(running, STATUS);
    expect(await rowTitles(window)).toEqual(listed.elements.map((e) => e.title));
    await window.screenshot({ path: path.join(SHOTS, "sr-124-filter-step-light.png") });
  });

  test("[SR-124/AK-qcw4] Filter list takes several types into one mark and adds one step of the types, the list of the CLI", async () => {
    const { window } = running;
    const label = window.getByLabel("Minibuffer").locator("label");
    const names = window.locator('.candidates [role="option"] .name');
    const before = await rowTitles(window);
    await filterList(window, "Type");
    await expect(label).toHaveText("Type");
    // Without a mark the hits are the types alone.
    await expect(names.filter({ hasText: /^Take / })).toHaveCount(0);
    await answer(window, "Type", "Need");
    await expect(label).toHaveText("Type");
    await expect(marks(window)).toHaveText(["type: need×"]);
    await expect(marked(window)).toHaveText("Take 1 type");
    await answer(window, "Type", "Decision");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    await expect(marked(window)).toHaveText("Take 2 types");
    await expect(names.filter({ hasText: /^(Need|Decision)$/ })).toHaveCount(0);
    // Escape and Backspace go back to the kinds with the mark; the list stays as it is.
    await window.keyboard.press("Escape");
    await expect(label).toHaveText("Filter by");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    await fs.mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: path.join(SHOTS, "sr-124-filter-type-mark-light.png") });
    expect(await rowTitles(window)).toEqual(before);
    await answer(window, "Filter by", "Type");
    await expect(marked(window)).toHaveText("Take 2 types");
    await window.keyboard.press("Backspace");
    await expect(label).toHaveText("Filter by");
    await expect(marks(window)).toHaveText(["type: need, decision×"]);
    await answer(window, "Filter by", "Type");
    await takeTypes(window, "Take 2 types");
    await expect(label).toHaveCount(0);
    await expect(window.getByLabel("Modeline")).toContainText("type: need, decision");
    const listed = await listedBy(running, { type: ["need", "decision"] });
    expect(listed.total).toBe(3);
    expect(await rowTitles(window)).toEqual(listed.elements.map((e) => e.title));
    await window.screenshot({ path: path.join(SHOTS, "sr-124-filter-types-step-light.png") });
  });

  test("[SR-215/AK-rx2z] in Filter list, Backspace at the kinds removes the type mark, and a value of another kind adds only its step", async () => {
    const { window } = running;
    const label = window.getByLabel("Minibuffer").locator("label");
    await filterList(window, "Type");
    await answer(window, "Type", "Need");
    // Escape goes back only once the type is in the mark: an Enter that still waits for the types ("searching…",
    // SR-119) is not taken when Escape goes back (SR-134 AK1), and the mark would be lost (#1800).
    await expect(marks(window)).toHaveText(["type: need×"]);
    await window.keyboard.press("Escape");
    await expect(label).toHaveText("Filter by");
    await expect(marks(window)).toHaveText(["type: need×"]);
    await window.keyboard.press("Backspace");
    await expect(marks(window)).toHaveCount(0);
    await answer(window, "Filter by", "Type");
    await answer(window, "Type", "Need");
    await expect(marks(window)).toHaveText(["type: need×"]);
    await window.keyboard.press("Escape");
    await expect(label).toHaveText("Filter by");
    await expect(marks(window)).toHaveText(["type: need×"]);
    await answer(window, "Filter by", "Status");
    await answer(window, "Status", "Draft");
    await expect(window.getByLabel("Modeline")).toContainText("status: draft");
    await expect(window.getByLabel("Modeline")).not.toContainText("type:");
  });
});
