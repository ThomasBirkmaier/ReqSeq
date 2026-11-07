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

const search = async (window: Page, query: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+F");
  await window.keyboard.type(query);
  await window.keyboard.press("Enter");
  await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", `Search: ${query}`);
  // A new search starts empty (SR-122): its rows are read once they are there. Every query here has hits.
  await expect(window.locator(".row").first()).toBeVisible();
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

  test("[SR-174/AK1] a hit in the text says text and shows the snippet of its visible text, marked; the keys still open it", async () => {
    const { window } = running;
    await search(window, "gusts pulse");
    const hits = await searched(running, "gusts pulse");
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

  test("[SR-174/AK2] a hit only in a property names the property and shows the snippet of the value with the match", async () => {
    const { window } = running;
    await search(window, "hurricane");
    const hits = await searched(running, "hurricane");
    expect(await shown(window)).toEqual(expected(hits));
    expect(await shown(window)).toMatchObject([
      { snippet: "Checks: The dial warns before a hurricane arrives.", snippetMarks: ["hurricane"] },
    ]);
    // A Markdown text property: its visible words, before the list in metamodel order.
    await search(window, "hail");
    expect(await shown(window)).toEqual(expected(await searched(running, "hail")));
    expect(await shown(window)).toMatchObject([{ snippet: "Notes: A hail sensor beside the dial." }]);
    await shot(window, "search-snippets-property");
  });

  test("[SR-174/AK4] a hit only in the title or an ID shows no snippet, and the title is marked", async () => {
    const { window } = running;
    await search(window, "icing");
    const hits = await searched(running, "icing");
    expect(await shown(window)).toEqual(expected(hits));
    expect(await shown(window)).toMatchObject([
      { title: "Survive icing", titleMarks: ["icing"], snippet: undefined },
    ]);
    await search(window, "SR-203");
    expect(await window.locator(".row .snippet").count()).toBe(0);
    await expect(window.locator(".row .id mark")).toHaveText("SR-203");

    // The screenshot for the pull request: a hit in the title only above a hit in the text.
    await search(window, "wind");
    await expect(window.locator(".row .snippet").first()).toBeVisible();
    expect(await shown(window)).toEqual(expected(await searched(running, "wind")));
    await shot(window, "search-snippets");
  });
});
