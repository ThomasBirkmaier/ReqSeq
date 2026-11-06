// A grouped list (SR-149) on the built app: "Group list" offers type, status, package and the properties
// with values to choose of the listed elements; the list shows each group under its heading with its
// count, regroups and ungroups in the same filter and sort, and no file of the workspace changes.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll, snapshot } from "./support/app.js";

/** 14 elements: 6 draft, 7 approved, 1 obsolete (fixtures/README.md). */
const FIXTURE = { fixture: "SR-069/filter" };

const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');
const candidates = (window: Page): Locator => window.locator('.candidates [role="option"] .name');

const command = async (window: Page, title: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(candidates(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
};

/** "Group list", then the grouping `name`. */
const groupBy = async (window: Page, name: string): Promise<void> => {
  await command(window, "Group list");
  await expect(window.locator(".minibuffer")).toContainText("Group by");
  await window.keyboard.type(name);
  await expect(candidates(window).first()).toHaveText(name);
  await window.keyboard.press("Enter");
};

test.describe("a grouped list", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp(FIXTURE);
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-149/AK4] the command line offers type, status, package and the properties with values to choose", async () => {
    const { window } = running;
    await command(window, "Group list");
    await expect(candidates(window)).toHaveText([
      "Type",
      "Status",
      "Package",
      "requirement-type",
      "validity",
      "emergent",
      "verification-method",
    ]);
  });

  test("[SR-149/AK3] the list shows its groups with heading and count, regroups and ungroups in the same sort", async () => {
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const before = await snapshot(root);
    const headings = shownBuffer(window).locator(".group h2");
    const ids = shownBuffer(window).locator(".row .id");
    const plain = await ids.allTextContents();
    await groupBy(window, "Status");
    await expect(headings).toHaveText(["Draft 6", "Approved 7", "Obsolete 1"]);
    // Inside each group the rows keep the order of the list: the same sort.
    const groups = shownBuffer(window).locator(".group");
    for (const at of [0, 1, 2]) {
      const inGroup = await groups.nth(at).locator(".row .id").allTextContents();
      expect(inGroup).toEqual(plain.filter((id) => inGroup.includes(id)));
    }
    await groupBy(window, "Type");
    await expect(headings.first()).toContainText(/^[A-Z][A-Za-z ]+ \d+$/);
    await command(window, "Ungroup list");
    await expect(headings).toHaveCount(0);
    await expect(ids).toHaveText(plain);
    expect(await snapshot(root)).toEqual(before);
  });
});
