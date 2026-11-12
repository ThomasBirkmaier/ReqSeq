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

  test("[SR-149/AK-mfr6] the command line offers type, status, package and the properties with values to choose", async () => {
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

  test("[SR-149/AK-pd1k] the list shows its groups with heading and count, regroups and ungroups in the same sort", async () => {
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const before = await snapshot(root);
    const headings = shownBuffer(window).locator(".group h2");
    const ids = shownBuffer(window).locator(".row .id");
    const plain = await ids.allTextContents();
    await groupBy(window, "Status");
    // The obsolete element stands in the folded section at the end, collapsed (SR-201).
    await expect(headings).toHaveText(["Draft 6", "Approved 7"]);
    await expect(shownBuffer(window).locator(".row.fold-row")).toHaveText("▸ Folded statuses (1)");
    // The rows of all groups share one grid: their statuses stand in one line (#1275).
    const lefts = await shownBuffer(window)
      .locator(".group .row > .status")
      .evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().left)));
    expect(lefts.length).toBe(13);
    expect(new Set(lefts).size).toBe(1);
    // Inside each group the rows keep the order of the list: the same sort.
    const groups = shownBuffer(window).locator(".group");
    for (const at of [0, 1]) {
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

  test("[SR-201/AK-d03x] in a grouped list the folded section stands after the last group, collapsed with its count, and groups its elements by the same property", async () => {
    const { window } = running;
    await groupBy(window, "Status");
    const outer = shownBuffer(window).locator(".group:not(.folded .group) h2");
    await expect(outer).toHaveText(["Draft 6", "Approved 7"]);
    const section = shownBuffer(window).locator(".folded");
    await expect(section.locator(".row.fold-row")).toHaveText("▸ Folded statuses (1)");
    await expect(section.locator(".row.fold-row")).toHaveAttribute("aria-expanded", "false");
    await expect(section.locator(".row:not(.fold-row)")).toHaveCount(0);
    // Nothing comes after it; the last group stands right before it.
    expect(
      await section.evaluate((folded) => ({
        last: folded.nextElementSibling === null,
        before: folded.previousElementSibling?.querySelector("h2")?.textContent,
      })),
    ).toEqual({ last: true, before: "Approved 7" });
    await section.locator(".row.fold-row").click();
    await expect(section.locator(".group h2")).toHaveText(["Obsolete 1"]);
    await expect(section.locator(".group .row")).toHaveCount(1);
  });
});
