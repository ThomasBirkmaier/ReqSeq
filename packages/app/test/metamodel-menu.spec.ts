// The context menus of the metamodel's graph (SR-199 AK5 to AK7) and the mark of the last change (SR-130 AK7)
// on the built app, on a copy of fixtures/SR-130/metamodel: a right-click on the name or prefix of a type, a
// property row, a status, the label line of a relation property or of a relation kind offers the commands of
// that place, and each opens the command prompt with the definition given. "Add status to type" run from the
// menu writes the metamodel, the graph and the text mark the new status until the next metamodel command,
// and a removal marks nothing. Right-clicks go through Chromium's input (Playwright's mouse). The light
// screenshot goes to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));
const ALL = "All commands…";

const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entryNames = (window: Page): Promise<string[]> =>
  menu(window).getByRole("menuitem").locator(".name").allTextContents();
const label = (window: Page): Locator => window.locator("label.prompt-label");
const input = (window: Page): Locator => window.locator("#prompt-input");
const marked = (window: Page): Locator => window.locator('.candidates [aria-selected="true"] .name');
const box = (window: Page, type: string): Locator => window.locator(`.mm-type[data-type="${type}"]`);

/** Right-clicks `target`, checks the entries of the menu, and chooses `name` among them. */
const chooseOn = async (target: Locator, entries: readonly string[], name: string): Promise<void> => {
  const window = target.page();
  await target.click({ button: "right" });
  await expect(menu(window)).toBeVisible();
  expect(await entryNames(window)).toEqual([...entries, ALL]);
  await menu(window).getByRole("menuitem").filter({ hasText: name }).first().click();
  await expect(menu(window)).toBeHidden();
};

/** The texts of the places marked as the last change. */
const changed = (window: Page): Promise<string[]> => window.locator(".changed").allTextContents();

test.describe("the context menus of the metamodel's graph (SR-199)", () => {
  let running: RunningApp;

  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-130/metamodel" }, { colorScheme: "light" });
    const { window } = running;
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Show metamodel");
    await expect(marked(window)).toHaveText("Show metamodel");
    await window.keyboard.press("Enter");
    await expect(window.locator(".metamodel")).toHaveAttribute("data-laid-out", "6");
  });

  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-199/AK-gh1p] the name or prefix of a type offers its commands, each with the type given", async () => {
    const { window } = running;
    const typeMenu = [
      "Add property to type",
      "Add status to type",
      "Change type definition",
      "Add relation kind",
      "Remove type",
    ];
    await chooseOn(box(window, "decision").locator(".mm-name"), typeMenu, "Add relation kind");
    // The type is the source type: the prompt starts with the name.
    await expect(label(window)).toHaveText("Add relation kind Decision · Name:");
    await window.keyboard.press("Escape");
    await chooseOn(box(window, "decision").locator(".mm-prefix"), typeMenu, "Change type definition");
    await expect(label(window)).toHaveText("Change type definition Decision · Change:");
    await window.keyboard.press("Escape");
  });

  test("[SR-199/AK-xd26] a property offers its commands with the type that has it, a status with its type", async () => {
    const { window } = running;
    const propertyMenu = ["Change property definition", "Remove property from type"];
    // Software Requirement inherits Rationale from System Requirement.
    await chooseOn(
      box(window, "software-requirement").locator('.mm-property[data-property="rationale"]'),
      propertyMenu,
      "Change property definition",
    );
    await expect(label(window)).toHaveText(
      "Change property definition Rationale System Requirement · Change:",
    );
    await window.keyboard.press("Escape");
    // The label line of the relation property Package.
    await chooseOn(
      window.locator('.mm-line[data-property="packages"]'),
      propertyMenu,
      "Change property definition",
    );
    await expect(label(window)).toHaveText("Change property definition Package System Requirement · Change:");
    await window.keyboard.press("Escape");
    await chooseOn(
      box(window, "software-requirement").locator('.mm-status[data-status="retired"]'),
      ["Change status definition", "Remove status from type"],
      "Change status definition",
    );
    await expect(label(window)).toHaveText("Change status definition Retired · Change:");
    await window.keyboard.press("Escape");
  });

  test("[SR-199/AK-r1q0] the label of a relation kind offers its commands, the kind given", async () => {
    const { window } = running;
    await chooseOn(
      window.locator('.mm-line[data-kind="delegates-to"]'),
      ["Change relation kind", "Remove relation kind"],
      "Change relation kind",
    );
    await expect(label(window)).toHaveText("Change relation kind Delegates to · Change:");
    await window.keyboard.press("Escape");
  });

  test("[SR-130/AK-wb12] the graph and the text mark a status added in the app until the next metamodel command, and nothing after a removal", async () => {
    const { window } = running;
    await fsp.mkdir(SHOTS, { recursive: true });
    expect(await changed(window)).toEqual([]);
    await chooseOn(
      box(window, "decision").locator(".mm-name"),
      [
        "Add property to type",
        "Add status to type",
        "Change type definition",
        "Add relation kind",
        "Remove type",
      ],
      "Add status to type",
    );
    await expect(label(window)).toHaveText("Add status to type Decision · Status:");
    await window.keyboard.type("Pending");
    await expect(marked(window)).toHaveText("New status Pending");
    await window.keyboard.press("Enter");
    await expect(input(window)).toHaveValue("pending");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(/· Invalid:$/u);
    await window.keyboard.type("no");
    await expect(marked(window)).toHaveText("no");
    await window.keyboard.press("Enter");
    const status = box(window, "decision").locator('.mm-status[data-status="pending"]');
    await expect(status).toHaveClass(/changed/u);
    expect(await changed(window)).toEqual(["Pending"]);
    await box(window, "decision").screenshot({ path: path.join(SHOTS, "sr-130-changed-light.png") });
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator('.mm-text-status.changed[data-status="pending"]')).toHaveText("Pending");
    expect(await changed(window)).toEqual(["Pending"]);
    await window.keyboard.press("ControlOrMeta+T");
    // A removal marks nothing.
    await chooseOn(
      status,
      ["Change status definition", "Remove status from type"],
      "Remove status from type",
    );
    await expect(box(window, "decision").locator('[data-status="pending"]')).toHaveCount(0);
    expect(await changed(window)).toEqual([]);
  });
});
