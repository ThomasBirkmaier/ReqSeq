// The place of a search hit in the built app (SR-174) on `fixtures/SR-174/snippets`: under the title of a
// hit in the text or in a property stands where it was found and the snippet `element search` gives, its
// marked words in a heavier weight; a hit in the title or an ID only has no snippet, its title marked. The
// rows keep the centred column (SR-148) and the keys of the list. A light-theme screenshot goes to
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

interface Marks {
  readonly start: number;
  readonly end: number;
}

interface Hit {
  readonly title: string;
  readonly titleMarks?: readonly Marks[];
  readonly snippet?: {
    readonly field: "text" | "properties";
    readonly propertyName?: string;
    readonly text: string;
    readonly marks: readonly Marks[];
  };
}

/** The hits of `element search` for `query`, as the CLI gives them. */
const searched = async (running: RunningApp, query: string): Promise<readonly Hit[]> => {
  const argv = ["element", "search", "--input", JSON.stringify({ query })];
  const result = await running.cli(argv);
  expect([argv.join(" "), result.code]).toEqual([argv.join(" "), 0]);
  return (JSON.parse(result.stdout) as { hits: Hit[] }).hits;
};

/**
 * Searches `query` in the app and gives the hits `element search` gives for it; returns once the app shows
 * as many rows (a new search starts empty, SR-122).
 */
const search = async (running: RunningApp, query: string): Promise<readonly Hit[]> => {
  const { window } = running;
  const hits = await searched(running, query);
  await window.keyboard.press("ControlOrMeta+Shift+F");
  await window.keyboard.type(query);
  await window.keyboard.press("Enter");
  await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", `Search: ${query}`);
  await expect(window.locator(".row")).toHaveCount(hits.length);
  return hits;
};

/** What each row shows: its title, its marked words, and the snippet line with its marked words. */
const shown = (window: Page) =>
  window.locator(".row").evaluateAll((rows) =>
    rows.map((row) => {
      const marks = (selector: string): string[] =>
        [...row.querySelectorAll(`${selector} mark`)].map((mark) => mark.textContent);
      const snippet = row.querySelector(".snippet");
      return {
        title: row.querySelector(".title")?.textContent,
        titleMarks: marks(".title"),
        snippet: snippet?.textContent,
        snippetMarks: marks(".snippet"),
        // Marked words are heavier, in the colour of the text around them (meaning, no colour).
        heavier: [...row.querySelectorAll("mark")].every(
          (mark) =>
            Number(getComputedStyle(mark).fontWeight) >
              Number(getComputedStyle(mark.parentElement ?? row).fontWeight) &&
            getComputedStyle(mark).color === getComputedStyle(mark.parentElement ?? row).color &&
            getComputedStyle(mark).backgroundColor === "rgba(0, 0, 0, 0)",
        ),
      };
    }),
  );

/** The rows the CLI's hits give: the snippet named by its field, as the app shows it. */
const expected = (hits: readonly Hit[]) =>
  hits.map((hit) => ({
    title: hit.title,
    titleMarks: (hit.titleMarks ?? []).map(({ start, end }) => hit.title.slice(start, end)),
    snippet:
      hit.snippet === undefined
        ? undefined
        : `${hit.snippet.field === "text" ? "text" : String(hit.snippet.propertyName)}: ${hit.snippet.text}`,
    snippetMarks: (hit.snippet?.marks ?? []).map(({ start, end }) => hit.snippet?.text.slice(start, end)),
    heavier: true,
  }));

const shot = async (window: Page, name: string): Promise<void> => {
  await fs.mkdir(OUT, { recursive: true });
  await window.screenshot({ path: path.join(OUT, `${name}.png`) });
};

test.describe("the place of a search hit", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-174/snippets" });
    await expect(running.window.locator(".overview .line").first()).toBeVisible();
    await running.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800);
    });
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-174/AK-mxnw] a hit in the text says text and shows the snippet of its visible text, marked; the keys still open it", async () => {
    const { window } = running;
    const hits = await search(running, "gusts pulse");
    expect(hits.map((hit) => hit.snippet?.field)).toEqual(["text"]);
    expect(await shown(window)).toEqual(expected(hits));
    expect(await shown(window)).toMatchObject([
      {
        snippet: "text: The anemometer measures gusts with pulse counting, as Show a dial shows.",
        snippetMarks: ["gusts", "pulse"],
      },
    ]);
    // One line under the title, in the centred column (SR-148).
    const title = await window.locator(".row .title").boundingBox();
    const snippet = await window.locator(".row .snippet").boundingBox();
    const column = await window.locator(".buffer.list .column").boundingBox();
    expect(title !== null && snippet !== null && column !== null).toBe(true);
    if (title !== null && snippet !== null && column !== null) {
      // Right under the title, without a gap between them.
      expect(snippet.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
      expect(snippet.y).toBeLessThan(title.y + title.height + 4);
      expect(snippet.height).toBeLessThan(title.height * 1.5);
      expect(snippet.x + snippet.width).toBeLessThanOrEqual(column.x + column.width + 1);
    }
    // Down selects the hit and Enter opens it, as in any list.
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Measure the wind");
  });

  test("[SR-174/AK-mxnw] a match deep in a snippet longer than the column stays in view: the words before it are left out", async () => {
    const { window } = running;
    const [hit] = await search(running, "squall");
    const full = hit?.snippet?.text ?? "";
    expect(full.length).toBeGreaterThan(100);
    expect(hit?.snippet?.marks[0]?.start).toBeGreaterThan(90);
    const snippet = window.locator(".row .snippet");
    await expect(snippet.locator("mark")).toHaveText("squall");
    const { line, mark } = await snippet.evaluate((element) => ({
      line: element.getBoundingClientRect().right,
      mark: element.querySelector("mark")?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
    }));
    expect(mark).toBeLessThanOrEqual(line + 0.5);
    // Shown from a word start with "…", the rest of core's line unchanged; the whole line is its tooltip.
    const text = (await snippet.textContent()) ?? "";
    expect(text).toMatch(/^text: …\S/);
    expect(full.endsWith(text.slice("text: …".length))).toBe(true);
    expect(text.length).toBeLessThan(`text: ${full}`.length);
    await expect(snippet).toHaveAttribute("title", `text: ${full}`);
    await shot(window, "search-snippets-long");
    // The option is named by ID, title and status; the snippet describes it.
    await expect(
      window.getByRole("option", { name: "SR-0000a4 (SR-204) Log the station draft" }),
    ).toHaveAccessibleDescription(`text: ${text.slice("text: ".length)}`);
  });

  test("[SR-174/AK-f869] a hit only in a property names the property and shows the snippet of the value with the match", async () => {
    const { window } = running;
    const hits = await search(running, "hurricane");
    expect(await shown(window)).toEqual(expected(hits));
    expect(await shown(window)).toMatchObject([
      { snippet: "Checks: The dial warns before a hurricane arrives.", snippetMarks: ["hurricane"] },
    ]);
    // A Markdown text property: its visible words, before the list in metamodel order.
    const hail = await search(running, "hail");
    expect(await shown(window)).toEqual(expected(hail));
    expect(await shown(window)).toMatchObject([{ snippet: "Notes: A hail sensor beside the dial." }]);
    await shot(window, "search-snippets-property");
  });

  test("[SR-174/AK-jtqc] a hit only in the title or an ID shows no snippet, and the title is marked", async () => {
    const { window } = running;
    const hits = await search(running, "icing");
    expect(await shown(window)).toEqual(expected(hits));
    expect(await shown(window)).toMatchObject([
      { title: "Survive icing", titleMarks: ["icing"], snippet: undefined },
    ]);
    await search(running, "SR-203");
    expect(await window.locator(".row .snippet").count()).toBe(0);
    await expect(window.locator(".row .id mark")).toHaveText("SR-203");

    // The screenshot for the pull request: a hit in the title only above a hit in the text.
    const wind = await search(running, "wind");
    expect(await shown(window)).toEqual(expected(wind));
    await shot(window, "search-snippets");
  });
});
