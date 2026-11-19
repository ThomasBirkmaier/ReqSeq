// Acceptance criteria in the search hits of the built app (SR-222) on `fixtures/SR-222/criteria`: a hit whose
// snippet stands in an acceptance criterion names its number and criterion key, the key marked when only it
// was found, in the list of search hits and in the hit card of the search prompt (SR-183 AK3); "Go to" lists
// the requirement of a typed criterion reference once, as the entry of its criterion. Light-theme
// screenshots go to `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS) for the pull request.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const shot = async (window: Page, name: string): Promise<void> => {
  await fs.mkdir(OUT, { recursive: true });
  await window.screenshot({ path: path.join(OUT, `${name}.png`) });
};

/** The card's list of hits. */
const card = (window: Page) => window.locator(".card:not(.card-leaving) .card-list");

/** Where each snippet under `rows` was found, the marks there, and the marked words of its line. */
const places = (rows: Locator) =>
  rows.evaluateAll((all) =>
    all.map((row) => ({
      where: row.querySelector(".snippet .where")?.textContent,
      whereMarks: [...row.querySelectorAll(".snippet .where mark")].map((mark) => mark.textContent),
      marks: [...row.querySelectorAll(".snippet > mark")].map((mark) => mark.textContent),
      // The location stands whole in the line, also in the narrower card.
      whole: (() => {
        const line = row.querySelector(".snippet")?.getBoundingClientRect();
        const where = row.querySelector(".snippet .where")?.getBoundingClientRect();
        return line !== undefined && where !== undefined && where.right <= line.right + 0.5;
      })(),
    })),
  );

const EXPECTED = [
  { where: "Acceptance Criteria AK2 (rqjp):", whereMarks: ["rqjp"], marks: [], whole: true },
  { where: "text:", whereMarks: [], marks: ["rqjp"], whole: true },
];

test.describe("acceptance criteria in the search hits", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-222/criteria" });
    await expect(shownLayer(running.window).locator(".overview .line").first()).toBeVisible();
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-222/AK-h8py] a hit found only by its criterion key names the criterion's number and key, the key marked, in the hit card and the list", async () => {
    const { window } = running;
    // The hit card of the search prompt (SR-183 AK3), at its narrower width.
    await window.keyboard.press("ControlOrMeta+Shift+F");
    await window.keyboard.type("rqjp");
    const hits = card(window).getByRole("option");
    await expect(hits).toHaveCount(2);
    expect(await places(hits)).toEqual(EXPECTED);
    await expect(hits.first().locator(".snippet")).toHaveText(
      "Acceptance Criteria AK2 (rqjp): Given a gust, then the alarm sounds.",
    );
    await shot(window, "criterion-search-card");

    // The list of search hits shows the same.
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Search: rqjp");
    const rows = shownLayer(window).locator(".row");
    await expect(rows).toHaveCount(2);
    expect(await places(rows)).toEqual(EXPECTED);
    await shot(window, "criterion-search-list");
  });

  test("[SR-222/AK-znd8] Go to lists the requirement of a typed criterion reference once, named with the criterion's number and text", async () => {
    const { window } = running;
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("[SR-036/AK-k7f3]");
    const entry =
      "SR-0000d1 (SR-036) Gust alarm · AK1 (k7f3) · Given a calm day, then the alarm stays silent.";
    await expect(card(window).locator('[role="option"] .name').filter({ hasText: entry })).toHaveCount(1);
    // The search finds the requirement by the reference too; it stands only as the criterion's entry.
    await expect(card(window).locator('[role="option"] .name').filter({ hasText: "Gust alarm" })).toHaveCount(
      1,
    );
    await shot(window, "criterion-search-go-to");
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator("article h1")).toHaveText("Gust alarm");
  });
});
