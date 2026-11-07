// The hits of a search filtered and grouped like any list (SR-124 AK4, SR-149 AK6) on the built app, on
// fixtures/SR-069/filter: "the" finds 8 elements of three statuses in an order of relevance that is not
// the store order. "Filter list by status" narrows the hits and they keep their order; "Group list" by
// status shows them under headings, each group in that order. A light-theme screenshot goes to
// `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS) for the pull request.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, snapshot } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const QUERY = "the";

const shownBuffer = (window: Page): Locator => window.locator('[aria-label="Sheet"] [data-buffer]');
const ids = (window: Page): Locator => shownBuffer(window).locator(".row .id");

/** The short IDs `element search` gives for the query within `selection`, in its order. */
const searched = async (running: RunningApp, selection?: unknown): Promise<string[]> => {
  const input = { query: QUERY, ...(selection === undefined ? {} : { selection }) };
  const argv = ["element", "search", "--input", JSON.stringify(input)];
  const result = await running.cli(argv);
  expect([argv.join(" "), result.code]).toEqual([argv.join(" "), 0]);
  return (JSON.parse(result.stdout) as { hits: { shortId: string }[] }).hits.map((hit) => hit.shortId);
};

const command = async (window: Page, title: string, answer: string, label: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(title);
  await window.keyboard.press("Enter");
  await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText(label);
  await window.keyboard.type(answer);
  await expect(window.locator('.candidates [role="option"] .name').first()).toHaveText(answer);
  await window.keyboard.press("Enter");
};

test.describe("search hits filtered and grouped", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-069/filter" });
    const { window } = running;
    // Keys count once the workspace is open and its first buffer is shown.
    await window.locator('[aria-label="Sheet"] > *').first().waitFor();
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type(QUERY);
    await window.keyboard.press("Enter");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", `Search: ${QUERY}`);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-124/AK4] a filter narrows the hits, and the hits left keep their order", async () => {
    const { window } = running;
    const plain = await searched(running);
    await expect(ids(window)).toHaveText(plain);
    await command(window, "Filter list by status", "draft", "Status");
    await expect(shownBuffer(window)).toHaveAttribute("aria-label", `Search: ${QUERY} · status: draft`);
    const filtered = await searched(running, { where: { status: ["draft"] } });
    expect(filtered.length).toBeGreaterThan(1);
    expect(filtered.length).toBeLessThan(plain.length);
    // The rows are the hits within the filter, in the order of the search without it.
    await expect(ids(window)).toHaveText(plain.filter((id) => filtered.includes(id)));
    await expect(ids(window)).toHaveText(filtered);
  });

  test("[SR-149/AK6] grouped by status, the hits stand under their headings, each group in the order of the search", async () => {
    const { window } = running;
    const root = running.workspace?.root ?? "";
    const before = await snapshot(root);
    const plain = await searched(running);
    await command(window, "Group list", "Status", "Group by");
    const headings = shownBuffer(window).locator(".group h2");
    await expect(headings).toHaveText(["Draft 3", "Approved 4", "Obsolete 1"]);
    const groups = shownBuffer(window).locator(".group");
    for (const at of [0, 1, 2]) {
      const inGroup = await groups.nth(at).locator(".row .id").allTextContents();
      expect(inGroup).toEqual(plain.filter((id) => inGroup.includes(id)));
    }
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "search-grouped-light.png") });
    // Not sortable: a search keeps the order of relevance.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Sort list");
    await expect(
      window.locator('.candidates [role="option"] .name').filter({ hasText: /^Sort list$/u }),
    ).toHaveCount(0);
    await window.keyboard.press("Escape");
    expect(await snapshot(root)).toEqual(before);
  });
});
