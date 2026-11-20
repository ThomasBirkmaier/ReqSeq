// Lists from outputs on the built app (SR-223 AK5, AK6): every number of elements in an output is a line of its own
// that opens exactly the list the command line gives for it (`selection.output` with `count`), and an output whose
// elements are its answer is a list of those elements under its answer, filtered, sorted and grouped like the list
// of all elements, with the values per element at its rows with "Show details". Such a list has the list's context
// menu (SR-198 AK1) and its rows the element's (SR-197 AK1, AK4), it is never saved as a perspective or a saved
// filter (SR-214 AK5, SR-219 AK8), it comes back after a restart (SR-115 AK4), and the records of older versions of
// "Show affected elements" stand above it (SR-024 AK4). The light screenshots go to
// `test-results/electron/screenshots/` (or the folder in REQSEQ_SCREENSHOTS).
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, recordRequests, shownLayer } from "./support/app.js";

const SHOTS =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

/** fixtures/SR-024/affected with an evidence folder and a record of an older version of "Show wind speed". */
const withRecord = async (): Promise<{
  readonly fixture: string;
  readonly files: Readonly<Record<string, string>>;
}> => {
  const workspace = await readFile(path.join(FIXTURES, "SR-024/affected/reqseq-workspace.yaml"), "utf8");
  return {
    fixture: "SR-024/affected",
    files: {
      "reqseq-workspace.yaml": `${workspace}evidence:\n  - { repository: system, path: evidence }\n`,
      "evidence/2026-11-01-SR-00b001-inspection.md":
        "---\nreqseq-record: 1\nkind: verification\nelement: 5c0e1d2a-0024-4024-8024-00000000b001\n" +
        "version: n2:0000000000000000\nmethod: inspection\nitem: build-1\nresult: passed\n" +
        "date: 2026-11-01T08:00:00Z\n---\n",
    },
  };
};

const names = (window: Page): Locator => window.locator('.candidates [role="option"] .name');
const menu = (window: Page): Locator => window.getByRole("menu", { name: "Context menu" });
const entryNames = (window: Page): Promise<string[]> =>
  menu(window).getByRole("menuitem").locator(".name").allTextContents();
const modeline = (window: Page): Locator => window.getByLabel("Modeline");
const list = (window: Page): Locator => shownLayer(window).locator(".buffer.list");

/** The entries of the context menu of `target`; the menu closes again. */
const menuOf = async (target: Locator): Promise<string[]> => {
  const window = target.page();
  await target.click({ button: "right" });
  await expect(menu(window)).toBeVisible();
  const entries = await entryNames(window);
  await window.keyboard.press("Escape");
  await expect(menu(window)).toBeHidden();
  return entries;
};

/** Runs the command or action titled `title` from the command prompt, `refs` as the answers it asks. */
const run = async (window: Page, title: string, ...refs: readonly string[]): Promise<void> => {
  await window.locator('[aria-label="Sheet"] > *').first().waitFor();
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(title);
  await expect(names(window).first()).toHaveText(title);
  await window.keyboard.press("Enter");
  for (const ref of refs) {
    await window.keyboard.type(ref);
    await expect(names(window).first()).toContainText(ref);
    await window.keyboard.press("Enter");
  }
};

/** The answer and the elements the CLI gives (SR-080). */
const cli = async (running: RunningApp, argv: readonly string[]): Promise<Record<string, unknown>> =>
  JSON.parse((await running.cli([...argv, "--json"])).stdout) as Record<string, unknown>;

/** The short IDs of the elements `element list` gives for `selection`. */
const listed = async (running: RunningApp, selection: unknown): Promise<string[]> => {
  const output = await cli(running, ["element", "list", "--input", JSON.stringify({ selection })]);
  return (output["elements"] as { shortId: string }[]).map((element) => element.shortId).sort();
};

/** The short IDs of the rows the shown list shows. */
const rowIds = async (window: Page): Promise<string[]> =>
  (await list(window).locator(".row:not(.fold-row) .id").allTextContents()).sort();

/** "Show details" by its keys (SR-223 AK2). */
const showDetails = async (window: Page): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+K");
  await window.keyboard.press("d");
};

test.describe("lists from outputs", () => {
  let running: RunningApp;
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-223/AK-zc7t] each number of elements is a line of its own and opens exactly the list the CLI gives for it", async () => {
    running = await launchApp({ fixture: "SR-024/affected" });
    const { window } = running;
    await run(window, "Show verification degree");
    const page = shownLayer(window).locator(".result.output");
    await expect(page.locator("h1")).toBeVisible();
    // Every count of the degree is a line that opens, the share is none.
    const counts = page.locator(".line.count");
    await expect(counts.locator(".label")).toHaveText([
      "Requirements",
      "Open",
      "Verified",
      "Indirect",
      "Failed",
      "Outdated",
    ]);
    await expect(page.locator(".line.count", { hasText: "Share" })).toHaveCount(0);
    await window.screenshot({ path: path.join(SHOTS, "sr-223-counts-light.png") });
    // By keyboard: Down to "Open", Enter.
    const lines = await page
      .locator(".line")
      .evaluateAll((all) => all.map((line) => line.querySelector(".label")?.textContent ?? ""));
    for (let step = 0; step <= lines.indexOf("Open"); step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await expect(page.locator(".line[data-cursor] .label")).toHaveText("Open");
    await window.keyboard.press("Enter");
    await expect(list(window).locator("h1")).toContainText("Show verification degree · Open");
    const open = {
      output: { command: "evidence.degree", input: {}, count: { field: "degree.counts.open" } },
    };
    const expected = await listed(running, open);
    expect(expected.length).toBeGreaterThan(0);
    await expect.poll(() => rowIds(window)).toEqual(expected);
    await expect(modeline(window)).toContainText(String(expected.length));
    await window.screenshot({ path: path.join(SHOTS, "sr-223-count-list-light.png") });
    // A click on another count opens its own list: "Requirements", all of them.
    await window.keyboard.press("Alt+KeyP");
    await expect(page.locator("h1")).toBeVisible();
    await page.locator(".line.count", { hasText: "Requirements" }).click();
    const all = await listed(running, {
      output: { command: "evidence.degree", input: {}, count: { field: "degree.total" } },
    });
    await expect.poll(() => rowIds(window)).toEqual(all);
    // The number of the checked elements of "Check workspace" opens them too.
    await run(window, "Check workspace");
    await shownLayer(window).locator(".result.output .line.count").first().click();
    const checked = await listed(running, {
      output: { command: "workspace.check", input: {}, count: { field: "checkedElements" } },
    });
    await expect.poll(() => rowIds(window)).toEqual(checked);
  });

  test("[SR-223/AK-qwkc] an output whose elements are its answer is a list under its answer that filters, sorts and groups; details show at its rows", async () => {
    running = await launchApp(await withRecord());
    const { window } = running;
    const requests = await recordRequests(window);
    await run(window, "Show affected elements", "SR-00b001");
    const answer = (await cli(running, ["trace", "affected", "5c0e1d2a-0024-4024-8024-00000000b001"]))[
      "answer"
    ] as string;
    // The answer heads the list as its first step; the rows are those of the output.
    await expect(list(window).locator("h1")).toContainText(answer);
    await expect.poll(() => rowIds(window)).toEqual(["SR-00b002", "SR-00b003", "SR-00b004"]);
    await expect(modeline(window)).toContainText("3");
    // SR-024 AK4: the records of an older version stand above the list, as lines of their own.
    const above = list(window).locator(".output-lines");
    await expect(above.locator(".line").first()).toContainText("Records of older versions");
    await expect(above).toContainText("build-1");
    await window.screenshot({ path: path.join(SHOTS, "sr-223-answer-list-light.png") });
    // The command ran once, for the prompt: the list shows that output besides its rows.
    const affected = (await requests.sent()).filter((request) => request.name === "trace.affected");
    expect(affected).toHaveLength(1);
    // Show details: the distance and the way at each row; again hides them.
    await showDetails(window);
    const gusts = list(window).locator(".row", { hasText: "SR-00b002" });
    await expect(gusts.locator(".row-detail", { hasText: "Distance" })).toContainText("1");
    await expect(gusts.locator(".row-detail", { hasText: "Link kind" })).toContainText("relation");
    await window.screenshot({ path: path.join(SHOTS, "sr-223-answer-list-details-light.png") });
    await showDetails(window);
    await expect(list(window).locator(".row-detail")).toHaveCount(0);
    // Grouped by status, sorted by title descending, and filtered like the list of all elements.
    await run(window, "Group list", "Type");
    await expect(list(window).locator(".group h2").first()).toBeVisible();
    await run(window, "Ungroup list");
    await run(window, "Sort list", "Title", "descending");
    await expect(list(window).locator(".row .title")).toHaveText([
      "Warn of storms",
      "Show wind direction",
      "Show gusts",
    ]);
    await run(window, "Filter list", "Text search");
    await expect(window.locator("label.prompt-label")).toHaveText("Text");
    await window.keyboard.type("storm");
    await window.keyboard.press("Enter");
    await expect.poll(() => rowIds(window)).toEqual(["SR-00b004"]);
    // The status line counts what the filters leave.
    await expect(modeline(window)).toContainText("1");
    // After a change of the workspace the heading says the answer of the output as it is now.
    await rm(path.join(running.workspace?.root ?? "", "evidence/2026-11-01-SR-00b001-inspection.md"));
    const now = (await cli(running, ["trace", "affected", "5c0e1d2a-0024-4024-8024-00000000b001"]))[
      "answer"
    ] as string;
    expect(now).not.toBe(answer);
    await expect(list(window).locator("h1")).toContainText(now);
    await expect(list(window).locator(".output-lines")).not.toContainText("build-1");
    // Without elements the buffer shows only the answer.
    await run(window, "Show affected elements", "SR-00b004");
    const none = (await cli(running, ["trace", "affected", "5c0e1d2a-0024-4024-8024-00000000b004"]))[
      "answer"
    ] as string;
    await expect(list(window).locator("h1")).toContainText(none);
    await expect(list(window).locator(".row")).toHaveCount(0);
    await expect(list(window)).not.toContainText("No elements");
  });

  test("[SR-197/AK-tzn9] [SR-198/AK-qc75] [SR-214/AK-bzs1] [SR-219/AK-zznw] a list from an output has the list's menu, its rows the element's, and it is never saved", async () => {
    running = await launchApp(await withRecord());
    const { window } = running;
    await run(window, "Show affected elements", "SR-00b001");
    await expect(list(window).locator(".row").first()).toBeVisible();
    // SR-197 AK4: a row of a list of elements is no output row: it has the element's menu.
    const row = await menuOf(list(window).locator(".row").first());
    expect(row.slice(0, 2)).toEqual(["Show element", "Show graph"]);
    // A line of the output above the list has the menu of the buffer, as the free sheet beside the column has it
    // (SR-194 AK6).
    const box = await list(window).boundingBox();
    await list(window).click({ button: "right", position: { x: 20, y: (box?.height ?? 100) - 20 } });
    await expect(menu(window)).toBeVisible();
    const ofBuffer = await entryNames(window);
    await window.keyboard.press("Escape");
    expect(ofBuffer.slice(0, 3)).toEqual(["Go to element or buffer", "Search elements", "Close buffer"]);
    expect(await menuOf(list(window).locator(".output-lines .line").first())).toEqual(ofBuffer);
    // SR-198 AK1: its heading has the list's menu.
    expect(await menuOf(list(window).locator("h1"))).toEqual([
      "Filter list",
      "Sort list",
      "Group list",
      "All commands…",
    ]);
    // SR-214 AK5, SR-219 AK8: neither "Save list as perspective" nor "Save list as saved filter".
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("Save list as");
    await expect(names(window).filter({ hasText: /^Save list as/u })).toHaveCount(0);
    await window.keyboard.press("Escape");
  });

  test("[SR-115/AK-qtv5] a list from an output comes back after a restart with its selection output", async () => {
    running = await launchApp({ fixture: "SR-024/affected" });
    let { window } = running;
    await run(window, "Show affected elements", "SR-00b001");
    await expect.poll(() => rowIds(window)).toEqual(["SR-00b002", "SR-00b003", "SR-00b004"]);
    const name = (await list(window).getAttribute("aria-label")) ?? "";
    const { kept } = running;
    await running.close({ keep: true });
    running = await launchApp(undefined, { kept });
    ({ window } = running);
    await expect(shownLayer(window).locator("[data-buffer]")).toHaveAttribute("aria-label", "Overview");
    await expect
      .poll(
        async () => {
          await window.keyboard.press("ControlOrMeta+P");
          await names(window)
            .first()
            .waitFor({ timeout: 1000 })
            .catch(() => undefined);
          const offered = await names(window).allTextContents();
          await window.keyboard.press("Escape");
          return offered;
        },
        { timeout: 15_000 },
      )
      .toContain(name);
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type(name);
    await window.keyboard.press("Enter");
    await expect.poll(() => rowIds(window)).toEqual(["SR-00b002", "SR-00b003", "SR-00b004"]);
  });
});
