// The hits of the search prompt in the built app (SR-183) on `fixtures/SR-183/preview`: Ctrl/Cmd+Shift+F
// shows the first hits of the search buffer while typing, as many as fit the card at its size for
// commands, each with its title and the snippet under it, none chosen; Ctrl+N, Ctrl+P or the arrows choose
// one and Enter opens it, Enter without one opens the search buffer. A light-theme screenshot goes to
// `test-results/electron/screenshots/` (or REQSEQ_SCREENSHOTS) for the pull request.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp } from "./support/app.js";

const OUT =
  process.env["REQSEQ_SCREENSHOTS"] ??
  fileURLToPath(new URL("../../../test-results/electron/screenshots", import.meta.url));

/** An element in the folded status obsolete that is the best hit for "gust" (SR-183 AK2, SR-201). */
const GAUGE_FILE = "requirements/SR-00000000000a.md";
const GAUGE = [
  "---",
  "id: 18300000-0000-4000-8000-00000000000a",
  "type: system-requirement",
  "status: obsolete",
  "title: Gust gauge",
  "spec-id: SR-310",
  "---",
  "",
  "Gust after gust, the gauge counts each gust.",
  "",
].join("\n");

/** The card's list of hits. */
const card = (window: Page) => window.locator(".card:not(.card-leaving) .card-list");

/** The size of the card's list: its box, and whether it scrolls. */
const measure = (window: Page) =>
  card(window).evaluate((list) => ({
    height: list.getBoundingClientRect().height,
    scrolls: list.scrollHeight > list.clientHeight + 1,
  }));

/** Opens the search prompt and types `query`; returns once the card shows `count` hits. */
const preview = async (window: Page, query: string, count: number): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+F");
  await window.keyboard.type(query);
  await expect(card(window).getByRole("option")).toHaveCount(count);
};

const names = (window: Page) => card(window).locator('[role="option"] .name').allTextContents();

test.describe("the hits of the search prompt", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-183/preview" });
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-183/AK1] shows as many hits as fit the card at its size for commands, none chosen; fewer hits all", async () => {
    const { window } = running;
    // The card at its size for commands: the command prompt lists more commands than it holds.
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await expect(card(window).getByRole("option").nth(12)).toBeAttached();
    const commands = await measure(window);
    expect(commands.scrolls).toBe(true);
    await window.keyboard.press("Escape");

    // Eight hits with a snippet: five fit, the card is no higher and does not scroll.
    await preview(window, "gust", 5);
    const hits = await measure(window);
    expect(hits.scrolls).toBe(false);
    expect(hits.height).toBeLessThanOrEqual(commands.height + 0.5);
    expect(hits.height).toBeGreaterThan(commands.height - 25);
    await expect(card(window).locator('[aria-selected="true"]')).toHaveCount(0);
    await expect(window.locator("#prompt-input")).not.toHaveAttribute("aria-activedescendant");
    await window.keyboard.press("Escape");

    await preview(window, "squall", 2);
    expect((await measure(window)).scrolls).toBe(false);
  });

  test("[SR-183/AK2] the hits are the first of the search buffer for the same text, in its order; [SR-183/AK5] Enter without a choice opens it", async () => {
    const { window } = running;
    await preview(window, "gust", 5);
    const shown = await names(window);
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Search: gust");
    await expect(window.locator(".row")).toHaveCount(8);
    const rows = await window
      .locator(".row")
      .evaluateAll((all) =>
        all.map(
          (row) =>
            `${row.querySelector(".id")?.textContent ?? ""} ${row.querySelector(".title")?.textContent ?? ""}`,
        ),
      );
    expect(shown).toEqual(rows.slice(0, 5));
  });

  test("[SR-183/AK2] the best hit in a folded status stands first, at its place by relevance; the search buffer shows it in the section at the end", async () => {
    await running.close();
    running = await launchApp({ fixture: "SR-183/preview", files: { [GAUGE_FILE]: GAUGE } });
    const { window } = running;
    await expect(window.locator(".overview .line").first()).toBeVisible();
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
    // The CLI ranks the obsolete hit first.
    const searched = await running.cli(["element", "search", "gust"]);
    const hits = (JSON.parse(searched.stdout) as { hits: { title: string; status: string }[] }).hits;
    expect(hits[0]).toMatchObject({ title: "Gust gauge", status: "obsolete" });
    expect(hits).toHaveLength(9);
    await preview(window, "gust", 5);
    const shown = await names(window);
    expect(shown[0]).toMatch(/ Gust gauge$/);
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "Search: gust");
    const section = window.locator(".row.fold-row");
    await expect(section).toHaveText("▸ Folded statuses (1)");
    const rows = window.locator(".row:not(.fold-row)");
    await expect(rows).toHaveCount(8);
    const rowNames = async (): Promise<string[]> =>
      rows.evaluateAll((all) =>
        all.map(
          (row) =>
            `${row.querySelector(".id")?.textContent ?? ""} ${row.querySelector(".title")?.textContent ?? ""}`,
        ),
      );
    // Without the folded hit, the others are the first rows of the search buffer, in its order.
    expect(shown.slice(1)).toEqual((await rowNames()).slice(0, 4));
    // The folded hit stands in the section at the end.
    await section.click();
    await expect(rows).toHaveCount(9);
    expect((await rowNames()).at(-1)).toBe(shown[0]);
  });

  test("[SR-183/AK3] a hit shows its title and, under it, the snippet around the match, as in the search buffer", async () => {
    const { window } = running;
    await preview(window, "squall", 2);
    const options = card(window).getByRole("option");
    await expect(options.locator(".snippet")).toHaveText([
      "text: It stands through a squall.",
      "text: The dial shows each gust and a squall as it comes.",
    ]);
    await expect(options.locator(".snippet mark")).toHaveText(["squall", "squall"]);
    await expect(options.first().locator(".hint")).toHaveText("draft");
    // A hit in the title is marked there.
    await window.keyboard.press("Escape");
    await preview(window, "dial", 1);
    await expect(card(window).locator(".name mark")).toHaveText("dial");
    await window.keyboard.press("Escape");

    await preview(window, "gust", 5);
    // Each snippet stands right under its title, measured at once, as the card may still be rising.
    const under = await card(window)
      .getByRole("option")
      .evaluateAll((options) =>
        options.map((option) => {
          const name = option.querySelector(".name")?.getBoundingClientRect();
          const snippet = option.querySelector(".snippet")?.getBoundingClientRect();
          return name !== undefined && snippet !== undefined && snippet.top >= name.bottom - 1;
        }),
      );
    expect(under).toEqual([true, true, true, true, true]);
    // The screenshot for the pull request, the second hit chosen.
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await window.waitForTimeout(400);
    await fs.mkdir(OUT, { recursive: true });
    await window.screenshot({ path: path.join(OUT, "search-preview.png") });
  });

  test("[SR-183/AK4] Enter opens the hit chosen with Ctrl+N, Ctrl+P or the arrows", async () => {
    const { window } = running;
    await preview(window, "gust", 5);
    const [, second] = await names(window);
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+N");
    await window.keyboard.press("Control+P");
    await expect(card(window).locator('[aria-selected="true"] .name')).toHaveText(second ?? "");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Show a dial");

    await preview(window, "squall", 2);
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Survive a squall");
  });
});
