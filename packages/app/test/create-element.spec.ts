// "Create element" on the built app (SR-064): the command prompt asks the type, the title and then each
// required property of the type in turn in the minibuffer; an empty input skips one. The new element opens
// with its title, its text and the properties that were given (D-062: an empty property shows no box), the
// minibuffer and the modeline count core's hints, and after reopening "Add property" offers every other
// property of the type. Each result is compared with the CLI and the file of the workspace (SR-080).
// Keys use ControlOrMeta (Linux and macOS).
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const FIXTURE = { fixture: "SR-069/filter" };
const TYPE = "system-requirement";
const TITLE = "Böen anzeigen";

interface Got {
  readonly element: {
    readonly id: string;
    readonly file: string;
    readonly title: string;
    readonly text: string;
    readonly properties: Record<string, unknown>;
    readonly problems?: readonly { readonly code: string; readonly message: string }[];
  };
}

interface Metamodel {
  readonly types: readonly {
    readonly key: string;
    readonly properties: string[];
    readonly required: string[];
  }[];
  readonly properties: readonly { readonly key: string; readonly name: string; readonly meaning?: string }[];
}

const label = (window: Page): Locator => window.getByLabel("Minibuffer").locator("label");
const echo = (window: Page): Locator => window.getByLabel("Minibuffer");
const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const names = (window: Page): Promise<string[]> =>
  window.locator('.candidates [role="option"] .name').allInnerTexts();

/** The labels of the property boxes (not the title, the text or the relations) in the order they are shown. */
const boxLabels = (window: Page): Promise<string[]> =>
  window
    .locator("[data-field]:has(> .box)")
    .evaluateAll((fields) => fields.map((node) => (node as HTMLElement).dataset["field"] ?? ""));

const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli(argv);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
};

/** The system requirement of the standard model as the CLI gives it: its properties and the required ones but the title. */
const systemRequirement = async (running: RunningApp) => {
  const metamodel = await cliJson<Metamodel>(running, ["metamodel", "get"]);
  const type = metamodel.types.find((candidate) => candidate.key === TYPE);
  const title = metamodel.properties.find((property) => property.meaning === "title")?.key;
  expect(type).toBeDefined();
  return {
    properties: (type?.properties ?? []).filter((key) => key !== title),
    required: (type?.required ?? []).filter((key) => key !== title),
    names: new Map(metamodel.properties.map((property) => [property.key, property.name])),
  };
};

/** The element the app created, found by its title with the CLI. */
const created = async (running: RunningApp): Promise<Got> => {
  const found = await cliJson<{ readonly hits: readonly { readonly id: string; readonly title: string }[] }>(
    running,
    ["element", "search", TITLE],
  );
  const hit = found.hits.find((candidate) => candidate.title === TITLE);
  expect(hit).toBeDefined();
  return cliJson<Got>(running, ["element", "get", hit?.id ?? ""]);
};

const fileOf = (running: RunningApp, got: Got): Promise<string> =>
  fs.readFile(path.join(running.workspace?.root ?? "", ...got.element.file.split("/")), "utf8");

/** "Create element" from the command prompt, the type and the title; the prompt then asks the first required property. */
const createSystemRequirement = async (window: Page): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("Create element");
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Create element");
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText("Create element · type:");
  await window.keyboard.type("System Requirement");
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("System Requirement");
  await window.keyboard.press("Enter");
  await expect(label(window)).toHaveText("Create element System Requirement · title:");
  await window.keyboard.type(TITLE);
  await window.keyboard.press("Enter");
};

test.describe("Create element", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-064/AK1] asks after the type and the title only the required properties of the type, and shows the new element with its title, its text and the properties given", async () => {
    const { window } = running;
    const type = await systemRequirement(running);
    expect(type.required).toEqual(["requirement-type", "acceptance-criteria"]);
    await createSystemRequirement(window);
    // One required property after the other, in the order of the type, none of the optional ones.
    await expect(label(window)).toHaveText(`Create element System Requirement ${TITLE} · requirement-type:`);
    expect(await names(window)).toEqual(["Functional", "Quality", "Performance", "Interface", "Constraint"]);
    await window.keyboard.type("perf");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(
      `Create element System Requirement ${TITLE} Performance · acceptance-criteria:`,
    );
    // A list: one value per Enter, Enter on an empty input ends it.
    await window.keyboard.type("Böen über 20 m/s erscheinen.");
    await window.keyboard.press("Enter");
    await expect(label(window)).toContainText("· acceptance-criteria:");
    await window.keyboard.type("Ohne Messung erscheint n/a.");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    // The new element: its title, its (empty) text and exactly the boxes of the properties given.
    await expect(window.locator("article h1")).toHaveText(TITLE);
    await expect(window.locator('article [data-field="Text"] .cm-content')).toBeVisible();
    await expect(window.locator('article [data-field="Text"] .cm-content')).toHaveText("");
    expect(await boxLabels(window)).toEqual(type.required);
    const got = await created(running);
    expect(got.element.properties).toMatchObject({
      "requirement-type": "performance",
      "acceptance-criteria": ["Böen über 20 m/s erscheinen.", "Ohne Messung erscheint n/a."],
    });
    expect(Object.keys(got.element.properties).filter((key) => !type.properties.includes(key))).toEqual([]);
    expect(got.element.problems ?? []).toEqual([]);
    await expect(echo(window)).toContainText(new RegExp(`Created SR-\\w+ ${TITLE}$`, "u"));
  });

  test("[SR-064/AK2] with the required properties left empty the element is saved anyway, and the minibuffer and the modeline show the hints", async () => {
    const { window } = running;
    await createSystemRequirement(window);
    await expect(label(window)).toContainText("· requirement-type:");
    await window.keyboard.press("Enter");
    await expect(label(window)).toContainText("· acceptance-criteria:");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(TITLE);
    // Saved: the file is there, with no value for either property, and core gives a hint for each.
    const got = await created(running);
    const file = await fileOf(running, got);
    expect(file).toContain(`title: ${TITLE}`);
    expect(file).not.toContain("requirement-type");
    expect(file).not.toContain("acceptance-criteria");
    expect((got.element.problems ?? []).map((problem) => problem.code)).toEqual([
      "element.missing-required",
      "element.missing-required",
    ]);
    await expect(echo(window)).toContainText(" · 2 hints");
    await expect(modeline(window)).toContainText("2 hints");
    // No box for an empty property (D-062).
    expect(await boxLabels(window)).toEqual([]);
    // The text is saved like that of any element, and the hints stay counted.
    await window.keyboard.press("Enter");
    await window.keyboard.type("Das Tool zeigt Böen an.");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    await expect.poll(async () => (await created(running)).element.text).toContain("Das Tool zeigt Böen an.");
    await expect(modeline(window)).toContainText("2 hints");
  });

  test("[SR-064/AK3] after reopening, Add property offers every other property of the type, and a value added is saved to the file", async () => {
    const { window } = running;
    const type = await systemRequirement(running);
    await createSystemRequirement(window);
    await expect(label(window)).toContainText("· requirement-type:");
    await window.keyboard.press("Enter");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(TITLE);
    // Close the buffer and open the element again with Go to.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Close buffer");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText("Close buffer");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveCount(0);
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(TITLE);
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(TITLE);
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(TITLE);
    await expect(window.locator('article [data-field="Text"] .cm-content')).toBeVisible();
    await window.keyboard.press("ControlOrMeta+Alt+A");
    await expect(label(window)).toHaveText("Add property");
    // Every property of the type but the title: the required ones left empty and all the optional ones.
    expect((await names(window)).sort()).toEqual(
      type.properties.map((key) => type.names.get(key) ?? key).sort(),
    );
    await window.keyboard.type("verification");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Verification Method");
    await window.keyboard.type("test");
    await window.keyboard.press("Enter");
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    await expect
      .poll(async () => (await created(running)).element.properties["verification-method"])
      .toBe("test");
    expect(await fileOf(running, await created(running))).toContain("verification-method: test");
  });
});
