// The evidence columns of the traceability matrix (#233, SR-126) on the built app and
// `fixtures/SR-126/matrix` (its README lists what each requirement shows): "Test cases" with the result and
// date of each test case's last execution or its mark, "Verification" with the status, and above it the
// degree of the selection with the count per status, as `reqseq trace matrix` gives them (SR-080). Keys use
// ControlOrMeta, so the same tests run on Linux and macOS.
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, listAll } from "./support/app.js";

/** The row of the matrix whose element starts with `shortId`. */
const row = (window: Page, shortId: string): Locator =>
  window.locator("tbody tr").filter({ has: window.locator("td.element", { hasText: shortId }) });

const testCases = (window: Page, shortId: string): Locator => row(window, shortId).locator("td.test-cases");
const status = (window: Page, shortId: string): Locator => row(window, shortId).locator("td.verification");

test.describe("the evidence columns of the traceability matrix", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-126/matrix" });
    const { window } = running;
    await listAll(window);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator("tbody tr")).toHaveCount(11);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-126/AK1] the matrix has a column of test cases with result and date of the last execution and a column of the verification status", async () => {
    const { window } = running;
    const heads = window.locator("thead th .name");
    await expect(heads.nth(-2)).toHaveText("Test cases");
    await expect(heads.nth(-1)).toHaveText("Verification");
    // Failed on 2026-10-21, passed on 2026-10-22: the last execution is the passed one, unmarked.
    await expect(testCases(window, "SR-126b01")).toHaveText("test_speed[SR-126b01] · passed · 2026-10-22");
    await expect(testCases(window, "SR-126b01").locator(".marked")).toHaveCount(0);
    await expect(status(window, "SR-126b01")).toHaveText("verified");
    // A need is no requirement: both cells are blank, not a gap.
    await expect(testCases(window, "N-126a01")).toHaveText("");
    await expect(status(window, "N-126a01")).toHaveText("");
    const shots = process.env["REQSEQ_SCREENSHOTS"];
    if (shots !== undefined) {
      await window.screenshot({ path: path.join(shots, "matrix-evidence.png") });
    }
  });

  test("[SR-126/AK2] a requirement without test case, with a test case without execution, or with a failed or outdated execution is marked", async () => {
    const { window } = running;
    const marked = (shortId: string): Locator => testCases(window, shortId).locator(".marked");
    await expect(marked("SR-126b02")).toHaveText("test_log[SR-126b02] · failed · 2026-10-22");
    await expect(marked("SR-126b03")).toHaveText("test_trend[SR-126b03] · outdated · 2026-10-21");
    await expect(marked("SR-126b04")).toHaveText("test_gusts[SR-126b04] · not executed");
    // No test case: the accent "—"; grey when the status says open already (b06), accent when not (b05).
    const accentGap = testCases(window, "SR-126b05").locator(".gap:not(.settled)");
    const greyGap = testCases(window, "SR-126b06").locator(".gap.settled");
    await expect(accentGap).toHaveText("—");
    await expect(greyGap).toHaveText("—");
    const colour = (locator: Locator): Promise<string> =>
      locator.evaluate((node) => getComputedStyle(node).color);
    // The accent of a gap is the one of the relation columns ("Derives from" of the need); the grey one differs.
    const relationGap = row(window, "N-126a01").locator("td.cell .gap").first();
    expect(await colour(accentGap)).toBe(await colour(relationGap));
    expect(await colour(greyGap)).not.toBe(await colour(relationGap));
    await expect(status(window, "SR-126b02").locator(".marked")).toHaveText("failed");
    await expect(status(window, "SR-126b03").locator(".marked")).toHaveText("outdated");
  });

  test("[SR-126/AK3] an indirectly verified requirement has the status indirect", async () => {
    const { window } = running;
    await expect(status(window, "SR-126b07")).toHaveText("indirect");
    await expect(status(window, "SR-126b07").locator(".marked")).toHaveCount(0);
  });

  test("[SR-126/AK4] above the status column stands the degree of the selection with the count per status", async () => {
    const { window } = running;
    const cli = await running.cli(["trace", "matrix"]);
    const matrix = JSON.parse(cli.stdout) as {
      readonly evidence: { readonly degree: { readonly share: number; readonly total: number } };
    };
    expect(matrix.evidence.degree.total).toBe(9);
    await expect(window.locator("thead th.verification .count")).toHaveText(
      "55.5 % · 4 verified · 1 indirect · 1 failed · 1 outdated · 2 open",
    );
  });
});
