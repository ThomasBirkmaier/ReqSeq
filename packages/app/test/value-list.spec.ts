// From a value of the shown element to the list of every element with that value (SR-132, #497) on the
// built app: the key, the command and the prompt "Elements with", each list compared with what the CLI
// gives for the condition property equals value (SR-080). Keys use the modifier of the platform, so the
// same tests run on Linux and macOS. The clicks come with the second PR of SR-132.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, modifier } from "./support/app.js";

const P = "69069069-0000-4000-8000-0000000000";
const PACKAGE_D1 = `  - { id: ${P}d1, version: n1:1111111111111111 }\n`;
const SWR = (tail: string, title: string, labels: string): string =>
  `---\nid: ${P}${tail}\ntype: software-requirement\nstatus: draft\ntitle: ${title}\nrequirement-type: functional\nacceptance-criteria:\n  - Given ${tail}, when it is checked, then it holds.\nlabels: ${labels}\n---\n`;

/**
 * The filter fixture plus two draft requirements on the topics Timing and Wind in the package Sensors (as
 * in list-filters.spec.ts), one with a rationale, and a few-valued text list `labels` on the software
 * requirements (a copy of the fixture's metamodel with one more property): a value of a list property.
 */
const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: ${P}b6\ntype: system-requirement\nstatus: draft\ntitle: Measure the rain\nrationale: Rain falls on the sensor.\nrequirement-type: functional\nacceptance-criteria:\n  - Given rain, when it is checked, then it holds.\ntopic: Timing\npackages:\n${PACKAGE_D1}---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: ${P}b7\ntype: system-requirement\nstatus: draft\ntitle: Measure the hail\nrequirement-type: functional\nacceptance-criteria:\n  - Given hail, when it is checked, then it holds.\ntopic: Wind\npackages:\n${PACKAGE_D1}---\n`,
    "metamodel/software.yaml":
      "logreq-metamodel: 1\n\ntypes:\n  - key: software-requirement\n    name: Software Requirement\n    prefix: SWR\n    extends: system-requirement\n    properties: [priority, labels]\n\nproperties:\n  - { key: priority, name: Priority, kind: number }\n  - { key: labels, name: Labels, kind: text, many: true }\n",
    "requirements/SWR-0000000000f3.md": SWR("f3", "Time the samples", "[Timing, Safety]"),
    "requirements/SWR-0000000000f4.md": SWR("f4", "Guard the samples", "[Safety]"),
  },
};

const SPEC = fileURLToPath(new URL("../../../spec", import.meta.url));
const OUT =
  process.env["LOGREQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

interface Listed {
  readonly elements: readonly { readonly title: string }[];
  readonly total: number;
}

const rowTitles = (window: Page): Promise<string[]> => window.locator(".row .title").allTextContents();
const promptLabel = (window: Page): Locator => window.getByLabel("Minibuffer").locator("label");
const optionNames = (window: Page): Promise<string[]> =>
  window.locator('.candidates [role="option"] .name').allTextContents();

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

/** Opens the element with this title by "Go to" and waits until it is shown with its focus. */
const openElement = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press(`${await modifier(window)}+P`);
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
  await expect(window.locator("article")).toBeFocused();
};

/** Puts the caret at the start of line `line` (from 1) of the text box of `key`. */
const caretIn = async (window: Page, key: string, line = 1): Promise<void> => {
  await window
    .locator(`[data-field="${key}"] .cm-line`)
    .nth(line - 1)
    .click();
  await expect(window.locator(`[data-field="${key}"] .cm-content`)).toBeFocused();
};

/** The key of SR-132: Ctrl+Shift+Enter, Cmd+Shift+Enter on macOS. */
const listKey = async (window: Page): Promise<void> => {
  await window.keyboard.press(`${await modifier(window)}+Shift+Enter`);
};

/** Opens the command prompt, types `command` and runs the first candidate. */
const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press(`${await modifier(window)}+Shift+P`);
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

/** Types `text` into the prompt `label` once it is asked for and presses Enter. */
const answer = async (window: Page, label: string, text: string): Promise<void> => {
  await expect(promptLabel(window)).toHaveText(label);
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
};

/** The list shown is `label` and holds what the CLI lists for `where`, in the same order. */
const expectList = async (running: RunningApp, label: string, where: unknown): Promise<Listed> => {
  const listed = await listedBy(running, where);
  const modeline = running.window.getByLabel("Modeline");
  await expect(modeline).toContainText(label);
  await expect(modeline).toContainText(`${String(listed.total)} element`);
  await expect(running.window.locator(".row").first()).toBeVisible();
  expect(await rowTitles(running.window)).toEqual(listed.elements.map((e) => e.title));
  return listed;
};

const TIMING = { property: "topic", op: "eq", value: "Timing" };

test.describe.serial("the list of the elements with a value", () => {
  let running: RunningApp;
  test.beforeAll(async () => {
    running = await launchApp(FIXTURE);
    await running.window.locator('[aria-label="Sheet"] > *').first().waitFor();
  });
  test.afterAll(async () => {
    await running.close();
  });

  test("[SR-132/AK1] the key on the topic box and the command on a choice box open the list of the elements with that value", async () => {
    const { window } = running;
    await openElement(window, "Measure the rain");
    await caretIn(window, "topic");
    await listKey(window);
    const listed = await expectList(running, "topic: Timing", TIMING);
    expect(listed.elements.map((e) => e.title)).toContain("Measure the rain");
    // The command, with the focus on the box of a choice, which has no caret.
    await openElement(window, "Measure the rain");
    await window.locator('[data-field="requirement-type"]').focus();
    await runCommand(window, "list elements with this value");
    await expectList(running, "requirement-type: functional", {
      property: "requirement-type",
      op: "eq",
      value: "functional",
    });
  });

  test("[SR-132/AK2] the lists of one value of a list property and of the status hold what the CLI lists for property eq value", async () => {
    const { window } = running;
    await openElement(window, "Time the samples");
    await caretIn(window, "labels", 2);
    await listKey(window);
    const labels = await expectList(running, "labels: Safety", {
      property: "labels",
      op: "eq",
      value: "Safety",
    });
    expect(labels.elements.map((e) => e.title)).toEqual(["Time the samples", "Guard the samples"]);
    // The status is in the prompt "Elements with", which the key opens away from a box.
    await openElement(window, "Time the samples");
    await listKey(window);
    await answer(window, "Elements with", "status");
    const status = await expectList(running, "status: draft", {
      property: "status",
      op: "eq",
      value: "draft",
    });
    expect(status.total).toBe((await listedBy(running, { status: ["draft"] })).total);
  });

  test("[SR-132/AK3] the list of a package target holds the elements of the package, as the CLI lists them", async () => {
    const { window } = running;
    await openElement(window, "Measure the rain");
    await window.locator('[data-field="packages"] [role="link"]').first().focus();
    await listKey(window);
    const listed = await expectList(running, "packages: Sensors", {
      property: "packages",
      op: "eq",
      value: "PKG-0000d1",
    });
    expect(listed.elements.map((e) => e.title)).toContain("Measure the hail");
  });

  test("[SR-132/AK4] the rationale and the acceptance criteria offer no list: on their box the key and the command ask only among the other values", async () => {
    const { window } = running;
    await openElement(window, "Measure the rain");
    for (const key of ["rationale", "acceptance-criteria"]) {
      await caretIn(window, key);
      await listKey(window);
      await expect(promptLabel(window)).toHaveText("Elements with");
      const names = await optionNames(window);
      expect(names).toContain("topic: Timing");
      expect(names).toContain("status: draft");
      expect(names.filter((name) => name.startsWith("rationale") || name.startsWith("acceptance"))).toEqual(
        [],
      );
      await window.keyboard.press("Escape");
      await expect(window.locator("article h1")).toHaveText("Measure the rain");
    }
    await caretIn(window, "acceptance-criteria");
    await runCommand(window, "list elements with this value");
    await expect(promptLabel(window)).toHaveText("Elements with");
    expect((await optionNames(window)).some((name) => name.startsWith("acceptance"))).toBe(false);
    await window.keyboard.press("Escape");
  });

  test("[SR-132/AK5] a further filter narrows the list of a value as the CLI does", async () => {
    const { window } = running;
    await openElement(window, "Measure the rain");
    await caretIn(window, "topic");
    await listKey(window);
    await expectList(running, "topic: Timing", TIMING);
    await runCommand(window, "filter list by type");
    await answer(window, "Type", "system-requirement");
    const type = { type: ["system-requirement"] };
    await expectList(running, "topic: Timing · type: system-requirement", { all: [TIMING, type] });
    await runCommand(window, "filter list by status");
    await answer(window, "Status", "draft");
    await expectList(running, "topic: Timing · type: system-requirement · status: draft", {
      all: [TIMING, type, { status: ["draft"] }],
    });
    await runCommand(window, "clear all list filters");
    await expect(window.getByLabel("Modeline")).not.toContainText("topic");
  });
});

test.describe("the key under macOS", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    const { app, window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    // The renderer knows macOS by navigator.platform; a Mac runner reports it anyway.
    await app.context().addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    });
    await window.reload();
    await expect(window.locator(".overview .line").first()).toBeVisible();
    expect(await window.evaluate(() => navigator.platform)).toBe("MacIntel");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-132/AK1] under macOS Cmd+Shift+Enter opens the list; the physical Ctrl+Shift+Enter does not", async () => {
    const { window } = running;
    await openElement(window, "Measure the rain");
    // Cmd+Shift+Enter on the rationale asks: the facets of the element are answered and kept from here on.
    await caretIn(window, "rationale");
    await window.keyboard.press("Meta+Shift+Enter");
    await expect(promptLabel(window)).toHaveText("Elements with");
    await window.keyboard.press("Escape");
    await expect(window.locator(".candidates")).toHaveCount(0);
    await caretIn(window, "topic");
    await window.keyboard.press("Control+Shift+Enter");
    // Had the key listed, the list would be open after this: nothing to save (the topic is as stored) and
    // the facets kept, so it would open within the same task as the key; two frames later it has not.
    await window.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    await expect(window.locator('[data-field="topic"] .cm-content')).toHaveText("Timing");
    await expect(window.locator(".candidates")).toHaveCount(0);
    await expect(window.getByLabel("Modeline")).not.toContainText("topic: Timing");
    await expect(window.locator("article h1")).toHaveText("Measure the rain");
    await window.keyboard.press("Meta+Shift+Enter");
    await expectList(running, "topic: Timing", TIMING);
  });
});

test.describe("screenshots of the list of the elements with a value", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`screenshots of the prompt "Elements with" and the list of a topic on the spec in ${scheme}`, async () => {
      const running = await launchApp({ folder: SPEC }, { colorScheme: scheme });
      try {
        const { app, window } = running;
        await fs.mkdir(OUT, { recursive: true });
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
        });
        await window.locator('[aria-label="Sheet"] > *').first().waitFor();
        await openElement(window, "Vom Wert einer Property zur Liste der Elemente mit diesem Wert");
        await listKey(window);
        await expect(promptLabel(window)).toHaveText("Elements with");
        await expect(window.locator('.candidates [role="option"]').first()).toBeVisible();
        await window.screenshot({ path: path.join(OUT, `sr-132-prompt-${scheme}.png`) });
        await window.keyboard.type("topic");
        await window.keyboard.press("Enter");
        await expect(window.getByLabel("Modeline")).toContainText("topic: Bearbeiten und Finden");
        await expect(window.locator(".row").first()).toBeVisible();
        await window.screenshot({ path: path.join(OUT, `sr-132-list-${scheme}.png`) });
      } finally {
        await running.close();
      }
    });
  }
});
