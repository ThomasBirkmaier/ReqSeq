// The references of the acceptance criteria on the element page of the built app (SR-205 AK1, AK4): each
// criterion line ends with the reference `element get` gives for it, a criterion whose key another one
// carries too shows the bare key, and a new line shows its reference after the save (AK1); "Copy criterion
// reference" copies the reference of the criterion with the cursor, from the context menu and the command
// prompt (AK4). The fixture has no `identifier` meaning, so the references use the short ID. The light
// screenshots go to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";
import { criteriaMetamodel } from "./support/boxes.js";

const SR_ID = "20520520-0000-4000-8000-0000000000d1";
const SR_TITLE = "Windstärke anzeigen";
const TWIN_ID = "20520520-0000-4000-8000-0000000000d2";
const TWIN_TITLE = "Böenstärke anzeigen";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const requirement = (id: string, title: string, criteria: string): string => `---
id: ${id}
type: system-requirement
status: draft
title: ${title}
requirement-type: functional
acceptance-criteria:
${criteria}---

Das Tool zeigt die Windstärke.
`;

const FILES = {
  "requirements/SR-0000000000d1.md": requirement(
    SR_ID,
    SR_TITLE,
    "  - key: kaaa\n    text: Alpha\n  - key: kbbb\n    text: Beta\n",
  ),
  "requirements/SR-0000000000d2.md": requirement(
    TWIN_ID,
    TWIN_TITLE,
    "  - key: kccc\n    text: Gamma\n  - key: kddd\n    text: Delta\n  - key: kddd\n    text: Epsilon\n",
  ),
};

interface Entry {
  readonly key?: string;
  readonly reference?: string;
}

const criteriaBox = (window: Page): Locator => window.locator('[data-field="acceptance-criteria"]');
const line = (window: Page, at: number): Locator => criteriaBox(window).locator(".cm-line").nth(at);
const marks = (window: Page): Promise<string[]> =>
  criteriaBox(window).locator(".cm-lr-criterion-ref").allTextContents();
const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entryNames = (window: Page): Promise<string[]> =>
  menu(window).getByRole("menuitem").locator(".name").allTextContents();

/** Opens an element with "Go to"; the buffer has the focus. */
const open = async (window: Page, title: string): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"]').first()).toContainText(title);
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText(title);
};

test.describe("criterion references on the element page", () => {
  let running: RunningApp;
  let clipboard: string;
  test.beforeEach(async () => {
    running = await launchApp(
      {
        fixture: "SR-069/filter",
        files: { ...FILES, "metamodel/standard-model.yaml": await criteriaMetamodel() },
      },
      { colorScheme: "light" },
    );
    clipboard = await running.app.evaluate(({ clipboard: board }) => board.readText());
  });
  test.afterEach(async () => {
    try {
      await running.app.evaluate(({ clipboard: board }, text) => board.writeText(text), clipboard);
    } finally {
      await running.close();
    }
  });

  /** The criteria with their references, as `element get` of the CLI gives them. */
  const references = async (id: string): Promise<Entry[]> => {
    const got = await running.cli(["element", "get", id]);
    const output = JSON.parse(got.stdout) as { criterionReferences?: { criteria: Entry[] } };
    return output.criterionReferences?.criteria ?? [];
  };
  const readClipboard = (): Promise<string> =>
    running.app.evaluate(({ clipboard: board }) => board.readText());

  test("[SR-205/AK-npsp] each criterion line ends with its reference; a key two criteria carry shows bare; a new line after the save", async () => {
    const { window } = running;
    await open(window, TWIN_TITLE);
    const twins = await references(TWIN_ID);
    expect(twins.map((entry) => entry.reference === undefined)).toEqual([false, true, true]);
    await expect.poll(() => marks(window)).toEqual(twins.map((entry) => entry.reference ?? entry.key));
    expect((await marks(window)).slice(1)).toEqual(["kddd", "kddd"]);

    await open(window, SR_TITLE);
    const before = await references(SR_ID);
    await expect.poll(() => marks(window)).toEqual(before.map((entry) => entry.reference));
    // A new line shows nothing until the save, then the reference core gives it.
    await line(window, 1).click();
    await window.keyboard.press("End");
    await window.keyboard.press("Enter");
    await window.keyboard.type("Gamma");
    expect(await marks(window)).toHaveLength(2);
    await window.keyboard.press("ControlOrMeta+s");
    let after: Entry[] = [];
    await expect
      .poll(async () => {
        after = await references(SR_ID);
        return after.length;
      })
      .toBe(3);
    await expect.poll(() => marks(window)).toEqual(after.map((entry) => entry.reference));
    await window.screenshot({ path: path.join(OUT, "criterion-keys-light.png") });
  });

  test("[SR-205/AK-zvtb] Copy criterion reference copies the reference of the criterion with the cursor", async () => {
    const { window } = running;
    await open(window, SR_TITLE);
    const [alpha, beta] = await references(SR_ID);
    // From the context menu of a criterion line, right after "Copy field".
    await line(window, 1).click({ button: "right" });
    await expect(menu(window)).toBeVisible();
    const names = await entryNames(window);
    expect(names.slice(0, 2)).toEqual(["Copy field", "Copy criterion reference"]);
    await window.screenshot({ path: path.join(OUT, "criterion-reference-menu-light.png") });
    await menu(window)
      .getByRole("menuitem")
      .filter({ hasText: /^Copy criterion reference/ })
      .click();
    await expect(menu(window)).toBeHidden();
    await expect.poll(readClipboard).toBe(beta?.reference);
    // From the command prompt, with the cursor in the first line.
    await line(window, 0).click();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Copy criterion reference");
    await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(
      "Copy criterion reference",
    );
    await window.keyboard.press("Enter");
    await expect.poll(readClipboard).toBe(alpha?.reference);
  });
});
