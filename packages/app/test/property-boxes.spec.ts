// The property boxes of an element are edited in place (SR-104) on the built app: the boxes below the text
// are the filled properties of `logreq element get`, a box is typed in and saved with the text, an emptied
// box removes its property from the file (AK4), and the keys move between the boxes. Every result is
// compared with the CLI and the file of the workspace (SR-080). The numbers of the performance test are
// recorded, not asserted (a generous guard only). Keys use ControlOrMeta (Linux and macOS).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { markdownMetamodel, quoted } from "./support/boxes.js";

const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));
const RESULTS = fileURLToPath(new URL("../../../test-results/", import.meta.url));

const SR_ID = "69069069-0000-4000-8000-0000000000c4";
const SR_FILE = "requirements/SR-0000000000c4.md";
const SR_TITLE = "Boxen bearbeiten";
const CRITERIA = [
  "**Gegeben** ein Messwert, **wenn** er älter als eine Sekunde ist, **dann** zeigt das Tool ihn als veraltet.",
  "Die Anzeige bleibt *lesbar*, und `n/a` erscheint ohne Messung.",
  "Ein kurzer Satz.",
];
const TEXT = "Das Tool zeigt Messwerte an.";
const PACKAGE_ID = "69069069-0000-4000-8000-0000000000d1";

/** The element: filled boxes, empty properties (no box), a property the type does not know, a relation property. */
const elementFile = (criteria: readonly string[], more = ""): string => `---
id: ${SR_ID}
type: system-requirement
status: draft
title: ${SR_TITLE}
requirement-type: performance
acceptance-criteria:
${criteria.map((value) => `  - ${quoted(value)}`).join("\n")}
topic: Wind
rationale: ""
source: ""
statement: []
legacy: Altlast
packages:
  - { id: ${PACKAGE_ID}, version: n1:1111111111111111 }
${more}---

${TEXT}
`;

const workspace = async (criteria: readonly string[] = CRITERIA, more = "") => ({
  fixture: "SR-069/filter",
  files: {
    "metamodel/standard-model.yaml": await markdownMetamodel(),
    [SR_FILE]: elementFile(criteria, more),
  },
});

const field = (window: Page, label: string): Locator => window.locator(`[data-field="${label}"]`);
const modeline = (window: Page): Locator => window.getByLabel("Modeline");

/** The labels of the property boxes (not the title, the text or the relations) in the order they are shown. */
const boxLabels = (window: Page): Promise<string[]> =>
  window
    .locator("[data-field]:has(> .box)")
    .evaluateAll((fields) => fields.map((node) => (node as HTMLElement).dataset["field"] ?? ""));

interface Got {
  readonly element: {
    readonly properties: Record<string, unknown>;
    readonly relations: readonly {
      readonly kind: string;
      readonly direction: string;
      readonly property?: boolean;
    }[];
  };
}

const cliGet = async (running: RunningApp): Promise<Got> => {
  const result = await running.cli(["element", "get", SR_ID]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Got;
};

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "string" && value.trim() === "");

const readFile = (running: RunningApp): Promise<string> =>
  fs.readFile(path.join(running.workspace?.root ?? "", ...SR_FILE.split("/")), "utf8");

/** Opens the element with "Go to"; the buffer has the focus. */
const openElement = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(SR_TITLE);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(SR_TITLE);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(SR_TITLE);
  await expect(window.locator("article")).toBeFocused();
  // The keys of the element (Ctrl/Cmd+Alt+A) reach it once its text editor is there (#505).
  await expect(window.locator('article [data-field="Text"] .cm-content')).toBeVisible();
};

/** The field the focus is in (its label), or "" when the focus is outside the fields. */
const focusedField = (window: Page): Promise<string> =>
  window.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-field]")?.dataset["field"] ?? "");

test.describe("property boxes of an element", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(await workspace());
    await openElement(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-104/AK1] shows every filled property as a box below the text and none for an empty one, as the CLI gives them", async () => {
    const { window } = running;
    const got = await cliGet(running);
    const filled = Object.entries(got.element.properties)
      .filter(([, value]) => !isEmpty(value))
      .map(([key]) => key);
    // The file has empty properties, a property the type does not know and a relation property: both
    // sides see the same, and the targets of the relation property are a box with links, not a group.
    expect(filled).toContain("legacy");
    expect(filled).toContain("packages");
    await expect(field(window, "packages").locator('[role="link"]')).toHaveCount(
      got.element.relations.filter((r) => r.property === true && r.kind === "packages").length,
    );
    await expect(window.locator("article h2")).toHaveCount(
      new Set(got.element.relations.filter((r) => r.property !== true).map((r) => `${r.direction}${r.kind}`))
        .size,
    );
    expect(await boxLabels(window)).toEqual(filled);
    for (const empty of ["rationale", "source", "statement"]) {
      await expect(field(window, empty)).toHaveCount(0);
    }
    // Below the text.
    const text = await field(window, "Text").boundingBox();
    for (const label of filled) {
      const box = await field(window, label).boundingBox();
      expect(box?.y ?? 0).toBeGreaterThan((text?.y ?? 0) + (text?.height ?? 0) - 1);
    }
    // The values are those of the CLI, one per line.
    await expect(field(window, "acceptance-criteria").locator(".cm-line")).toHaveCount(3);
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("Wind");
    // A property the type does not know is shown, and not edited (D-012, spec question #469).
    await expect(field(window, "legacy")).toContainText("Altlast");
    await expect(field(window, "legacy").locator(".cm-editor")).toHaveCount(0);
  });

  test("saves the text and the boxes that changed with one Ctrl/Cmd+S, and leaves the bytes of everything else", async () => {
    const { window } = running;
    const before = await readFile(running);
    const topic = field(window, "topic");
    await topic.locator(".cm-line").click();
    await window.keyboard.press("End");
    await window.keyboard.type(" und Böen");
    // The file does not change before the save.
    expect(await readFile(running)).toBe(before);
    // A new value in the list: Enter at the end of the last one.
    const lines = field(window, "acceptance-criteria").locator(".cm-line");
    await lines.last().click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Ein neuer Satz.");
    await expect(lines).toHaveCount(4);
    await expect(modeline(window)).toContainText("modified");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    const got = await cliGet(running);
    expect(got.element.properties["topic"]).toBe("Wind und Böen");
    expect(got.element.properties["acceptance-criteria"]).toEqual([...CRITERIA, "Ein neuer Satz."]);
    // Properties that were not touched keep their lines.
    const after = await readFile(running);
    for (const kept of [
      "type: system-requirement",
      "legacy: Altlast",
      "requirement-type: performance",
      TEXT,
    ]) {
      expect(after).toContain(kept);
    }
    expect(after).toContain("packages:\n  - { id: " + PACKAGE_ID + ", version: n1:1111111111111111 }");
    // The boxes show what the file holds.
    await expect(topic.locator(".cm-content")).toHaveText("Wind und Böen");
    await expect(lines).toHaveCount(4);
  });

  test("[SR-104/AK4] emptying a box and saving removes the property from the file, and the box is gone", async () => {
    const { window } = running;
    const criteria = field(window, "acceptance-criteria");
    await criteria.locator(".cm-line").first().click();
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.press("Backspace");
    // The box stays, empty, until it is saved.
    await expect(criteria).toHaveCount(1);
    await expect(criteria.locator(".cm-line")).toHaveText("");
    expect(await readFile(running)).toContain("acceptance-criteria:");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(criteria).toHaveCount(0);
    expect(await readFile(running)).not.toContain("acceptance-criteria");
    const got = await cliGet(running);
    expect(Object.keys(got.element.properties)).not.toContain("acceptance-criteria");
    expect(await boxLabels(window)).not.toContain("acceptance-criteria");
    // The other boxes are still there.
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("Wind");
  });

  test("a single value is cleared the same way", async () => {
    const { window } = running;
    await field(window, "topic").locator(".cm-line").click();
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.press("Backspace");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(field(window, "topic")).toHaveCount(0);
    expect(await readFile(running)).not.toContain("topic:");
    expect(Object.keys((await cliGet(running)).element.properties)).not.toContain("topic");
  });

  /** The names of the candidates of the open prompt, in order (the hint is not part of the name). */
  const candidates = (window: Page): Promise<string[]> =>
    window.locator('.candidates [role="option"] .name').allInnerTexts();
  const promptLabel = (window: Page): Locator => window.getByLabel("Minibuffer").locator("label");

  test("[SR-104/AK2] Ctrl/Cmd+Alt+A adds a text property: an empty box with the caret in it at the place of the type, the file unchanged until it is saved", async () => {
    const { window } = running;
    const before = await readFile(running);
    await window.keyboard.press("ControlOrMeta+Alt+A");
    await expect(promptLabel(window)).toHaveText("Add property");
    // The properties of the type that no box shows, by name, with the stored empty ones.
    const offered = await candidates(window);
    expect(offered).toContain("Delivery");
    expect(offered).toContain("Rationale");
    expect(offered).not.toContain("Title");
    expect(offered).not.toContain("Topic");
    expect(offered).not.toContain("Acceptance Criteria");
    await window.keyboard.type("delivery");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Delivery");
    await window.keyboard.press("Enter");
    // An empty box, in the order of the type (before topic), with the caret in it.
    await expect(field(window, "delivery")).toHaveCount(1);
    await expect(field(window, "delivery").locator(".cm-content")).toBeFocused();
    await expect(field(window, "delivery").locator(".cm-content")).toHaveText("");
    expect(await boxLabels(window)).toEqual([
      "requirement-type",
      "acceptance-criteria",
      "delivery",
      "topic",
      "legacy",
      "packages",
    ]);
    // Nothing is a draft or in the file before there is a value and a save.
    await expect(modeline(window)).not.toContainText("modified");
    expect(await readFile(running)).toBe(before);
    await window.keyboard.type("Lieferung");
    await expect(modeline(window)).toContainText("modified");
    expect(await readFile(running)).toBe(before);
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    expect((await cliGet(running)).element.properties["delivery"]).toBe("Lieferung");
    expect(await readFile(running)).toContain("delivery: Lieferung");
    await expect(field(window, "delivery").locator(".cm-content")).toHaveText("Lieferung");
  });

  test("[SR-104/AK2] adding a choice puts the empty box in the page and opens the prompt with the choices at once; Escape leaves the focus on the box", async () => {
    const { window } = running;
    const before = await readFile(running);
    await window.keyboard.press("ControlOrMeta+Alt+A");
    await window.keyboard.type("verification");
    await window.keyboard.press("Enter");
    await expect(field(window, "verification-method")).toHaveCount(1);
    await expect(promptLabel(window)).toHaveText("Verification Method");
    await expect(field(window, "verification-method").locator(".line")).toHaveCount(0);
    // Exactly the values of the metamodel.
    expect(await candidates(window)).toEqual(["Test", "Analysis", "Inspection", "Demonstration"]);
    await window.keyboard.press("Escape");
    await expect(window.locator('[role="combobox"]')).toHaveCount(0);
    // The focus is on the new box, not on the element, and the box is empty.
    await expect(field(window, "verification-method")).toBeFocused();
    await expect(field(window, "verification-method").locator(".line")).toHaveCount(0);
    await expect(modeline(window)).not.toContainText("modified");
    expect(await readFile(running)).toBe(before);
    // The box takes the choice with Enter, again with the prompt.
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText("Verification Method");
    await window.keyboard.type("insp");
    await window.keyboard.press("Enter");
    await expect(field(window, "verification-method")).toBeFocused();
    await expect(field(window, "verification-method")).toContainText("inspection");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    expect((await cliGet(running)).element.properties["verification-method"]).toBe("inspection");
    expect(await readFile(running)).toContain("verification-method: inspection");
  });

  test("[SR-104/AK2] Add property is also in the command prompt, by its name", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+Shift+P");
    // The prompt's input takes the keys only once it is mounted and focused.
    await expect(window.getByRole("combobox")).toBeFocused();
    await window.keyboard.type("add prop");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Add property");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(/Ctrl\+Alt\+A|⌥⌘A/);
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText("Add property");
  });

  test("[SR-104/AK3] the prompt of a choice offers only the values of the metamodel, with the one that is set first, and takes no free text", async () => {
    const { window } = running;
    await field(window, "requirement-type").focus();
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText("Requirement Type");
    expect(await candidates(window)).toEqual([
      "Performance",
      "Functional",
      "Quality",
      "Interface",
      "Constraint",
    ]);
    // Typed text only narrows the values; what is no value gives nothing, and Enter takes nothing.
    await window.keyboard.type("zzz");
    await expect(window.locator('.candidates [role="option"]')).toHaveCount(0);
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText("Requirement Type");
    // Select all of the prompt's input: Cmd+A on macOS, where the physical Ctrl+A goes to the line start.
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.type("qual");
    await window.keyboard.press("Enter");
    await expect(field(window, "requirement-type")).toBeFocused();
    await expect(field(window, "requirement-type")).toContainText("quality");
    await expect(modeline(window)).toContainText("modified");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    expect((await cliGet(running)).element.properties["requirement-type"]).toBe("quality");
    expect(await readFile(running)).toContain("requirement-type: quality");
    // The other properties keep their bytes.
    expect(await readFile(running)).toContain("legacy: Altlast");
  });

  test("a relation box shows its targets as links; its prompt finds only elements of the allowed types, and a target is added, then taken out", async () => {
    const { window } = running;
    const box = field(window, "packages");
    await expect(box.locator("li")).toHaveCount(1);
    await expect(box.locator("li")).toContainText("Sensors");
    await box.focus();
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText("Package");
    expect(await candidates(window)).toEqual([expect.stringContaining("Sensors")]);
    // The search is limited to the types of the property: the system requirement is not found.
    await window.keyboard.type(SR_TITLE);
    await window.waitForTimeout(400);
    await expect(window.locator('.candidates [role="option"]')).toHaveCount(0);
    await window.keyboard.press("ControlOrMeta+A");
    await window.keyboard.type("Display");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Display");
    await window.keyboard.press("Enter");
    await expect(box).toBeFocused();
    await expect(box.locator("li")).toHaveCount(2);
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    const got = await cliGet(running);
    const packages = got.element.relations.filter((r) => r.kind === "packages" && r.property === true);
    expect(packages).toHaveLength(2);
    expect(await readFile(running)).toContain("69069069-0000-4000-8000-0000000000d2");
    // Taking a target that is set removes it.
    await window.keyboard.press("Enter");
    await window.keyboard.type("Sensors");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("set");
    await window.keyboard.press("Enter");
    await expect(box.locator("li")).toHaveCount(1);
    await expect(box.locator("li")).toContainText("Display");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    const text = await readFile(running);
    expect(text).not.toContain("69069069-0000-4000-8000-0000000000d1");
    expect(text).toContain("69069069-0000-4000-8000-0000000000d2");
  });

  test("[SR-104/AK4] Clear property empties a choice and a relation box, Ctrl/Cmd+S removes both from the file, and the boxes are gone", async () => {
    const { window } = running;
    await field(window, "requirement-type").focus();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("clear prop");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Clear property");
    await window.keyboard.press("Enter");
    // The box stays, empty, until it is saved.
    await expect(field(window, "requirement-type")).toHaveCount(1);
    await expect(field(window, "requirement-type").locator(".line")).toHaveCount(0);
    expect(await readFile(running)).toContain("requirement-type: performance");
    await field(window, "packages").focus();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("clear prop");
    await window.keyboard.press("Enter");
    await expect(field(window, "packages").locator("li")).toHaveCount(0);
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    await expect(field(window, "requirement-type")).toHaveCount(0);
    await expect(field(window, "packages")).toHaveCount(0);
    const file = await readFile(running);
    expect(file).not.toContain("requirement-type");
    expect(file).not.toContain("packages");
    const got = await cliGet(running);
    expect(Object.keys(got.element.properties)).not.toContain("requirement-type");
    expect(Object.keys(got.element.properties)).not.toContain("packages");
    expect(got.element.relations.filter((r) => r.property === true)).toEqual([]);
    expect(await boxLabels(window)).not.toContain("requirement-type");
  });

  test("Backspace on a box that has the focus clears nothing: the action does", async () => {
    const { window } = running;
    await field(window, "requirement-type").focus();
    await window.keyboard.press("Backspace");
    await window.keyboard.press("Delete");
    await expect(field(window, "requirement-type")).toContainText("performance");
    await expect(modeline(window)).not.toContainText("modified");
  });

  test("a property the type does not know is a read-only box: Enter on it and Clear property say so or edit the text", async () => {
    const { window } = running;
    // Enter on the box opens no editor in it: the caret goes into the text, as on a box that is not edited.
    await field(window, "legacy").focus();
    await window.keyboard.press("Enter");
    await expect.poll(() => focusedField(window)).toBe("Text");
    expect(await field(window, "legacy").locator(".cm-editor").count()).toBe(0);
    await window.keyboard.press("Escape");
    await field(window, "legacy").focus();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("clear prop");
    await window.keyboard.press("Enter");
    await expect(window.getByLabel("Minibuffer")).toContainText(
      "legacy is not a property of this type: edit it in the file",
    );
    await expect(field(window, "legacy")).toContainText("Altlast");
  });

  test("[SR-104/AK3] the prompt of a choice over the page, next to a relation box (screenshot, light)", async () => {
    const { window } = running;
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    await field(window, "requirement-type").focus();
    await window.keyboard.press("Enter");
    await expect(promptLabel(window)).toHaveText("Requirement Type");
    await expect(window.locator('.candidates [role="option"]')).toHaveCount(5);
    await expect(field(window, "packages").locator("li")).toHaveCount(1);
    await window.mouse.move(0, 0);
    await window.screenshot({ path: path.join(OUT, "boxes-choice-relation.png") });
  });

  test("gives each box one Tab stop: the box itself, then the next box", async () => {
    const { window } = running;
    await field(window, "Title").focus();
    const stops: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      await window.keyboard.press("Tab");
      const itself = await window.evaluate(
        () => document.activeElement?.classList.contains("field") ?? false,
      );
      stops.push(`${await focusedField(window)}${itself ? "" : " (inside)"}`);
    }
    // The text has its editor as the stop; every box is a stop of its own, with nothing inside it.
    expect(stops).toEqual(["Text (inside)", "requirement-type", "acceptance-criteria", "topic"]);
  });

  test("Enter on a box puts the caret in it, Enter in a single value and Escape leave it, Escape on the box leaves for the element", async () => {
    const { window } = running;
    await field(window, "topic").focus();
    await window.keyboard.press("Enter");
    await expect(field(window, "topic").locator(".cm-content")).toBeFocused();
    await window.keyboard.type("!");
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("Wind!");
    await window.keyboard.press("Enter");
    await expect(field(window, "topic")).toBeFocused();
    await expect(field(window, "topic").locator(".cm-content")).toHaveText("Wind!");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Escape");
    await expect(field(window, "topic")).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(window.locator("article")).toBeFocused();
  });

  test("Down on the last line of the text goes to the next box, Up on the first line comes back; on a box the keys move to the next field", async () => {
    const { window } = running;
    await window.keyboard.press("Enter");
    await expect(field(window, "Text").locator(".cm-content")).toBeFocused();
    // The first box is a choice, which is not edited in place: it takes the focus itself.
    await window.keyboard.press("ArrowDown");
    await expect(field(window, "requirement-type")).toBeFocused();
    // From box to box without editing; Enter puts the caret at the end of the last value.
    await window.keyboard.press("ArrowDown");
    await expect(field(window, "acceptance-criteria")).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(field(window, "acceptance-criteria").locator(".cm-content")).toBeFocused();
    // The last value is one line: Down leaves for the next box, Up comes back to its end.
    await window.keyboard.press("ArrowDown");
    await expect(field(window, "topic").locator(".cm-content")).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await expect(field(window, "acceptance-criteria").locator(".cm-content")).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(field(window, "acceptance-criteria")).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await expect(field(window, "requirement-type")).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await expect(field(window, "Text").locator(".cm-content")).toBeFocused();
  });

  test("[SR-127/AK1] the source of a criterion shows on the line with the caret only (screenshot)", async () => {
    const { window } = running;
    await fs.mkdir(OUT, { recursive: true });
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    const lines = field(window, "acceptance-criteria").locator(".cm-line");
    await lines.nth(0).click();
    await window.keyboard.press("End");
    await expect(lines.nth(0)).toContainText("**Gegeben**");
    await expect(lines.nth(1)).not.toContainText("*");
    await window.mouse.move(0, 0);
    await window.screenshot({ path: path.join(OUT, "edit-boxes.png") });
  });
});

test.describe("property boxes with a long value", () => {
  const LONG = Array.from({ length: 60 }, (_, at) => `Wort${String(at)}`).join(" ");
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(await workspace([CRITERIA[2] ?? "", LONG]));
    await openElement(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("Down and Up move by visual lines in a wrapped last value before they leave the box", async () => {
    const { window } = running;
    const criteria = field(window, "acceptance-criteria");
    const content = criteria.locator(".cm-content");
    const last = criteria.locator(".cm-line").last();
    const rows = await last.evaluate((node) =>
      Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)),
    );
    expect(rows).toBeGreaterThan(2);
    // The caret on the first visual line of the last value.
    await last.click({ position: { x: 4, y: 4 } });
    for (let at = 1; at < rows; at += 1) {
      await window.keyboard.press("ArrowDown");
      await expect(content).toBeFocused();
    }
    // On the last visual line, Down goes to the next box.
    await window.keyboard.press("ArrowDown");
    await expect(field(window, "topic").locator(".cm-content")).toBeFocused();
    // Up comes back to the last visual line and walks up the wrapped value first.
    await window.keyboard.press("ArrowUp");
    await expect(content).toBeFocused();
    for (let at = 1; at < rows; at += 1) {
      await window.keyboard.press("ArrowUp");
      await expect(content).toBeFocused();
    }
    // The first visual line of the last value, but not of the box: Up goes to the value before.
    await window.keyboard.press("ArrowUp");
    await expect(content).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await expect(field(window, "requirement-type")).toBeFocused();
  });
});

test.describe("property boxes of an element with many values", () => {
  const MANY = 50;
  const criteria = Array.from(
    { length: MANY },
    (_, at) =>
      `**Gegeben** Messwert ${String(at)}, *wenn* er älter ist, \`dann\` zeigt das Tool ihn als veraltet an, sodass der Nutzer es sofort sieht.`,
  );
  const more = ["source-identifier: Q-1\n", "delivery: Lieferung\n", "issue: 12\n"].join("");
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(await workspace(criteria, more));
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("records the time to open the element and the time from a key to the paint in a box (numbers, no limit but a guard)", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(SR_TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(SR_TITLE);
    // Open: from the Enter key to the paint of the box of the 50 values.
    await window.evaluate((count) => {
      const w = globalThis as unknown as { __t0?: number; __open?: number };
      delete w.__t0;
      delete w.__open;
      addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter" && w.__t0 === undefined) {
            w.__t0 = event.timeStamp;
          }
        },
        { capture: true },
      );
      const check = (): void => {
        const lines = document.querySelectorAll('[data-field="acceptance-criteria"] .cm-line').length;
        // CodeMirror draws the lines in view and a margin, not all 50; how many depends on the size of the
        // window and on where the box lies in it (8 on the smaller window of the Windows runner, #304).
        if (lines >= count && w.__open === undefined && w.__t0 !== undefined) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              w.__open = performance.now() - (w.__t0 ?? 0);
            });
          });
        }
      };
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    }, 1);
    await window.keyboard.press("Enter");
    // Polled as one string, so that a timeout prints all of it: the key, the element, the lines and the paint.
    await expect
      .poll(
        () =>
          window.evaluate(() => {
            const w = globalThis as unknown as { __t0?: number; __open?: number };
            return JSON.stringify({
              key: w.__t0 !== undefined,
              title: document.querySelector("article h1")?.textContent ?? null,
              lines: document.querySelectorAll('[data-field="acceptance-criteria"] .cm-line').length,
              open: w.__open !== undefined,
            });
          }),
        { timeout: 30_000 },
      )
      .toContain('"open":true');
    const open = await window.evaluate(() => (globalThis as unknown as { __open: number }).__open);
    const lines = field(window, "acceptance-criteria").locator(".cm-line");
    // With the box in view, CodeMirror draws more of its values than at the opening.
    await field(window, "acceptance-criteria").scrollIntoViewIfNeeded();
    await expect.poll(() => lines.count()).toBeGreaterThanOrEqual(10);
    expect((await cliGet(running)).element.properties["acceptance-criteria"]).toHaveLength(MANY);
    expect(await window.locator(".cm-editor").count()).toBeLessThanOrEqual(10);
    // Typing: from the keydown to the paint of the character, in the middle of the list.
    await lines.nth(8).click();
    await window.keyboard.press("End");
    await window.evaluate(() => {
      const w = globalThis as unknown as { __key?: number; __latencies: number[] };
      w.__latencies = [];
      addEventListener(
        "keydown",
        (event) => {
          w.__key = event.timeStamp;
        },
        { capture: true },
      );
      new MutationObserver(() => {
        const start = w.__key;
        if (start !== undefined) {
          delete w.__key;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              w.__latencies.push(performance.now() - start);
            });
          });
        }
      }).observe(document.querySelector('[data-field="acceptance-criteria"] .cm-content') as Node, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    for (let at = 0; at < 20; at += 1) {
      await window.keyboard.type("x");
      await window.waitForTimeout(40);
    }
    const latencies = await window.evaluate(
      () => (globalThis as unknown as { __latencies: number[] }).__latencies,
    );
    expect(latencies.length).toBeGreaterThan(10);
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const worst = sorted.at(-1) ?? 0;
    const record = {
      values: MANY,
      editors: await window.locator(".cm-editor").count(),
      openMs: Math.round(open),
      keyToPaintMedianMs: Math.round(median * 10) / 10,
      keyToPaintWorstMs: Math.round(worst * 10) / 10,
    };
    // eslint-disable-next-line no-console -- the numbers are the result of this test, the PR quotes them.
    console.log(`PERF property boxes ${JSON.stringify(record)}`);
    await fs.mkdir(RESULTS, { recursive: true });
    await fs.writeFile(path.join(RESULTS, "perf-property-boxes.json"), JSON.stringify(record, null, 2));
    // A guard against a broken page, not a budget (SR-082 AK3 is about 50,000 elements).
    expect(open).toBeLessThan(1000);
    expect(worst).toBeLessThan(1000);
  });
});
