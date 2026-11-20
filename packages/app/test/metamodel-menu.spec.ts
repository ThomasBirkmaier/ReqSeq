// The context menus of the metamodel's graph (SR-199 AK5 to AK8) and the mark of the last change (SR-130 AK7)
// on the built app, on a copy of fixtures/SR-130/metamodel: a right-click on the name or prefix of a type, a
// property row, a status, the label line of a relation property or of a relation kind offers the commands of
// that place, and each opens the command prompt with the definition given. The four Remove entries run at
// once; a refused one writes no file and the echo line says core's reason (AK8). "Add status to type" run from the
// menu writes the metamodel, the graph and the text mark the new status until the next metamodel command in
// the app (a change through the CLI or by hand marks nothing), and a removal marks nothing. Right-clicks go
// through Chromium's input (Playwright's mouse). The two light screenshots, the marked status and a refused
// removal, go to `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
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

const echo = (window: Page): Locator => window.locator(".minibuffer .echo");
const TYPE_MENU = [
  "Add property to type",
  "Add status to type",
  "Change type definition",
  "Add relation kind",
  "Remove type",
];
const PROPERTY_MENU = ["Change property definition", "Remove property from type"];
const STATUS_MENU = ["Change status definition", "Remove status from type"];
const KIND_MENU = ["Change relation kind", "Remove relation kind"];

/** The content of every file of the workspace at `root`, by its path; a file gone since the listing is left out. */
const filesOf = async (root: string): Promise<Record<string, string>> => {
  const entries = await fsp.readdir(root, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    try {
      files[path.relative(root, file)] = await fsp.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return files;
};

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

  test("[SR-199/AK-r608] each Remove entry runs at once, without a step of the command prompt, and removes an unused definition", async () => {
    const { window } = running;
    // The fixture has no unused type: one is added through the CLI.
    const added = await running.cli(["metamodel", "add-type", "Note", "NT"]);
    expect(added.code, added.stderr).toBe(0);
    await expect(box(window, "note")).toBeVisible();
    await chooseOn(box(window, "note").locator(".mm-name"), TYPE_MENU, "Remove type");
    await expect(box(window, "note")).toHaveCount(0);
    await expect(echo(window)).toHaveText(/^Removed the type note/u);
    await expect(label(window)).toHaveCount(0);
    // A property the type has itself and no element holds.
    const component = box(window, "software-requirement").locator('.mm-property[data-property="component"]');
    await chooseOn(component, PROPERTY_MENU, "Remove property from type");
    await expect(component).toHaveCount(0);
    await expect(echo(window)).toHaveText(
      /^Removed the property component from the type software-requirement/u,
    );
    await expect(label(window)).toHaveCount(0);
    // A status of the type's own list that no element has.
    const decided = box(window, "decision").locator('.mm-status[data-status="decided"]');
    await chooseOn(decided, STATUS_MENU, "Remove status from type");
    await expect(decided).toHaveCount(0);
    await expect(echo(window)).toHaveText(/^Removed the status decided from the type decision/u);
    await expect(label(window)).toHaveCount(0);
    // A relation kind no element file holds.
    const kind = window.locator('.mm-line[data-kind="delegates-to"]');
    await chooseOn(kind, KIND_MENU, "Remove relation kind");
    await expect(kind).toHaveCount(0);
    await expect(echo(window)).toHaveText(/^Removed the relation kind delegates-to/u);
    await expect(label(window)).toHaveCount(0);
  });

  test("[SR-199/AK-r608] a refused removal writes nothing, and the command prompt says why", async () => {
    const { window } = running;
    const root = running.workspace?.root;
    expect(root).toBeDefined();
    if (root === undefined) {
      return;
    }
    const before = await filesOf(root);
    // An inherited status (SR-240 AK3): Retired comes from the list of Item.
    await chooseOn(
      box(window, "software-requirement").locator('.mm-status[data-status="retired"]'),
      STATUS_MENU,
      "Remove status from type",
    );
    await expect(echo(window)).toHaveText(
      "Type software-requirement has the status retired from the status list of type item; remove it there",
    );
    await expect(label(window)).toHaveCount(0);
    await fsp.mkdir(SHOTS, { recursive: true });
    await window.screenshot({ path: path.join(SHOTS, "sr-199-remove-refused-light.png") });
    // A type relation kinds name (SR-237 AK5).
    await chooseOn(box(window, "software-requirement").locator(".mm-name"), TYPE_MENU, "Remove type");
    await expect(echo(window)).toHaveText(
      /^Type software-requirement cannot be removed: relation kind derives-from has it as source type/u,
    );
    // A use: the decision of the fixture holds Title.
    await chooseOn(
      box(window, "decision").locator('.mm-property[data-property="title"]'),
      PROPERTY_MENU,
      "Remove property from type",
    );
    await expect(echo(window)).toHaveText(/^Property title stays in type decision while elements hold it/u);
    await expect(label(window)).toHaveCount(0);
    expect(await filesOf(root)).toEqual(before);
    await expect(box(window, "software-requirement").locator('[data-status="retired"]')).toHaveCount(1);
    await expect(box(window, "software-requirement")).toBeVisible();
    await expect(box(window, "decision").locator('.mm-property[data-property="title"]')).toBeVisible();
  });

  test("[SR-130/AK-wb12] the graph and the text mark a status added in the app until the next metamodel command, not a change through the CLI or by hand, and nothing after a removal", async () => {
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
    // A change through the CLI and one by hand mark nothing, and the mark of the app's change stays.
    const cli = await running.cli(["metamodel", "change-type", "decision", "--name", "Ruling"]);
    expect(cli.code, cli.stderr).toBe(0);
    await expect(box(window, "decision").locator(".mm-name")).toHaveText("Ruling");
    const types = path.join(running.workspace?.root ?? "", "model", "types.yaml");
    await fsp.writeFile(types, (await fsp.readFile(types, "utf8")).replace("name: Package", "name: Bundle"));
    await expect(box(window, "package").locator(".mm-name")).toHaveText("Bundle");
    expect(await changed(window)).toEqual(["Pending"]);
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
