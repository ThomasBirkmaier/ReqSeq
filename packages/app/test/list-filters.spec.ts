// Cascading list filters (SR-124, #425) on the built app: each "Filter list by ..." narrows the list
// the one before gave, and what the list shows is compared with what the CLI gives for the same
// selection (SR-080). Keys use ControlOrMeta, so the same tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

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

const listedBy = async (running: RunningApp, where: unknown): Promise<Listed> => {
  const result = await running.cli(["element", "list", "--input", JSON.stringify({ selection: { where } })]);
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
    running = await launchApp(FIXTURE);
    await expect(running.window.locator(".row").first()).toBeVisible();
  });
  test.afterEach(async () => {
    await running.close();
  });

  /** Package, type, status and property by keyboard (the example of SR-124 AK1); "Filter list by property" is typed as its initials. */
  const cascade = async (): Promise<void> => {
    const { window } = running;
    await runCommand(window, "flp");
    await answer(window, "Property", "packages");
    await answer(window, "packages", "Sensors");
    await runCommand(window, "filter list by type");
    await answer(window, "Type", "system-requirement");
    await runCommand(window, "filter list by status");
    await answer(window, "Status", "draft");
    await runCommand(window, "flp");
    await answer(window, "Property", "topic");
    await answer(window, "topic", "Timing");
  };

  test("[SR-124/AK1] package, type, status and property by keyboard give the list of the CLI for all four conditions", async () => {
    await cascade();
    const listed = await listedBy(running, { all: [PACKAGE, TYPE, STATUS, TOPIC] });
    await expect(running.window.getByLabel("Modeline")).toContainText(
      "packages: Sensors · type: system-requirement · status: draft · topic: Timing",
    );
    await expect(running.window.getByLabel("Modeline")).toContainText(`${String(listed.total)} elements`);
    expect(listed.total).toBe(2);
    expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
  });

  test("[SR-124/AK1] clear list filter removes only the last step", async () => {
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

  test("[SR-124/AK2] the property prompt offers topic, not the acceptance criteria", async () => {
    const { window } = running;
    await runCommand(window, "filter list by type");
    await answer(window, "Type", "system-requirement");
    await runCommand(window, "flp");
    await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Property");
    const names = await window.locator('.candidates [role="option"] .name').allTextContents();
    expect(names).toContain("topic");
    expect(names).toContain("status");
    expect(names).toContain("requirement-type");
    expect(names).not.toContain("acceptance-criteria");
    expect(names).not.toContain("title");
    await window.keyboard.press("Escape");
  });

  test("[SR-124/AK3] filter list by text search narrows the current list", async () => {
    const { window } = running;
    await runCommand(window, "filter list by type");
    await answer(window, "Type", "system-requirement");
    await runCommand(window, "filter list by text search");
    await answer(window, "Text", "icing");
    const result = await running.cli([
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { all: [TYPE, { text: "icing" }] } } }),
    ]);
    const listed = JSON.parse(result.stdout) as Listed;
    await expect(window.getByLabel("Modeline")).toContainText("type: system-requirement · text: icing");
    expect(await rowTitles(window)).toEqual(listed.elements.map((e) => e.title));
    expect(listed.elements.map((e) => e.title)).toContain("Survive icing");
  });
});
