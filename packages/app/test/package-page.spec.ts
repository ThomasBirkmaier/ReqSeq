// The package page (SR-112, #408) on the built app: an opened package shows below its title and text
// the elements that name it (AK1), and they sort and show as a tree like any list (AK2). What the
// page shows is compared with what the CLI gives for the same input (SR-080). Keys use ControlOrMeta,
// so the same tests run on Linux and macOS. The package is opened by Ctrl+P, so the tests do not
// depend on what the window shows at the start.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const P = "69069069-0000-4000-8000-0000000000";
const NAMES_SENSORS = (title: string, extra = ""): string =>
  `type: system-requirement\nstatus: draft\ntitle: ${title}\nrequirement-type: functional\nacceptance-criteria:\n  - Given it, when it is checked, then it holds.\npackages:\n  - { id: ${P}d1, version: n1:1111111111111111 }\n${extra}`;
/** The filter fixture (package Sensors holds b1 and b2) plus three more elements in it; one derives from b1, so the tree has a second level. */
const FIXTURE = {
  fixture: "SR-069/filter",
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: ${P}b6\n${NAMES_SENSORS("Measure the rain")}---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: ${P}b7\n${NAMES_SENSORS("Measure the hail")}---\n`,
    "requirements/SR-0000000000b8.md": `---\nid: ${P}b8\n${NAMES_SENSORS("Calibrate the rain", `derives-from:\n  - { id: ${P}b1, version: n1:1111111111111111 }\n`)}---\n`,
  },
};

interface Listed {
  readonly elements: readonly { readonly title: string }[];
  readonly tree?: readonly { readonly depth: number }[];
  readonly total: number;
}

/** What the CLI lists for the elements of the package Sensors, with `sort`. */
const listedBy = async (running: RunningApp, sort?: unknown): Promise<Listed> => {
  const input = { selection: { where: { package: "PKG-0000d1" } }, ...(sort === undefined ? {} : { sort }) };
  const result = await running.cli(["element", "list", "--input", JSON.stringify(input)]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Listed;
};

const memberTitles = (window: Page): Promise<string[]> =>
  window.locator(".members .row .title").allTextContents();

const memberIndents = (window: Page): Promise<string[]> =>
  window
    .locator(".members .row .title")
    .evaluateAll((titles) => titles.map((e) => (e as HTMLElement).style.paddingLeft));

/** Opens the package Sensors: Ctrl+P, its title, and Enter once the hit is there. */
const openPackage = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+P");
  await window.keyboard.type("Sensors");
  await expect(window.locator('.candidates [role="option"]').first()).toContainText("Sensors");
  await window.keyboard.press("Enter");
  await expect(window.locator("article h1")).toHaveText("Sensors");
  await expect(window.locator(".members .row").first()).toBeVisible();
};

/** Opens the command prompt, types `command` and runs the first candidate; then types `choice` for the prompt "Sort by". */
const sortBy = async (window: Page, choice: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type("sort list");
  await window.keyboard.press("Enter");
  await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText("Sort by");
  await window.keyboard.type(choice);
  await window.keyboard.press("Enter");
};

test.describe("the package page on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await expect(running.window.getByLabel("Modeline")).toContainText("Weather station");
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-112/AK1] the package page shows below title and text every element that names the package, as the CLI lists them", async () => {
    const { window } = running;
    await openPackage(window);
    const listed = await listedBy(running);
    expect(listed.total).toBe(5);
    expect(await memberTitles(window)).toEqual(listed.elements.map((element) => element.title));
    // Title, then text, then the elements, from top to bottom.
    const top = async (selector: string): Promise<number> =>
      (await window.locator(selector).first().boundingBox())?.y ?? -1;
    const [title, text, heading, first] = [
      await top("article h1"),
      await top(".cm-editor"),
      await top(".members h2"),
      await top(".members .row"),
    ];
    expect(title).toBeGreaterThanOrEqual(0);
    expect([title, text, heading, first]).toEqual([...[title, text, heading, first]].sort((a, b) => a - b));
    await expect(window.locator(".members h2")).toContainText("5");
  });

  test("Down and Enter open an element of the package, and Ctrl+P Enter comes back to the same row", async () => {
    const { window } = running;
    await openPackage(window);
    const listed = await listedBy(running);
    await window.keyboard.press("ArrowDown");
    await expect(window.locator(".members .list")).toBeFocused();
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(listed.elements[1]?.title ?? "");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Sensors");
    await expect(window.locator(".members .list")).toBeFocused();
    await expect(window.locator('.members [aria-selected="true"] .title')).toHaveText(
      listed.elements[1]?.title ?? "",
    );
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(listed.elements[2]?.title ?? "");
  });

  test("[SR-112/AK2] the elements of the package sort by title descending, as the CLI sorts them", async () => {
    const { window } = running;
    await openPackage(window);
    await sortBy(window, "title desc");
    const listed = await listedBy(running, [{ by: "title", order: "desc" }]);
    await expect(window.locator(".members h2")).toContainText("sorted by title descending");
    expect(await memberTitles(window)).toEqual(listed.elements.map((element) => element.title));
    expect([...listed.elements.map((element) => element.title)]).toEqual(
      [...listed.elements.map((element) => element.title)].sort().reverse(),
    );
    // The page is still the package: its title and text are there.
    await expect(window.locator("article h1")).toHaveText("Sensors");
  });

  test("[SR-112/AK2] the elements of the package show as the derivation tree, as the CLI gives it", async () => {
    const { window } = running;
    await openPackage(window);
    await sortBy(window, "hierarchy");
    const listed = await listedBy(running, [{ by: "hierarchy", order: "asc" }]);
    await expect(window.locator(".members h2")).toContainText("tree");
    expect(await memberTitles(window)).toEqual(listed.elements.map((element) => element.title));
    const depths = (listed.tree ?? []).map((node) => node.depth);
    expect(Math.max(...depths)).toBe(1);
    expect(await memberIndents(window)).toEqual(depths.map((depth) => `${String(depth * 1.25)}rem`));
  });
});
