// The traceability matrix (SR-125, #442) on the built app and the fixture fixtures/SR-125/matrix: Ctrl+T on a
// list, on a package page and on a list with a saved filter shows the matrix that `logreq trace matrix`
// gives for the same selection and sort (SR-080 AK2, SR-125 AK6). Keys use ControlOrMeta, so the same
// tests run on Linux and macOS.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { DEFAULT_SORT, launchApp, listAll } from "./support/app.js";

interface Relation {
  readonly id?: string;
  readonly shortId?: string;
  readonly identifier?: string;
  readonly title?: string;
  readonly targetState: string;
  readonly outdated?: boolean;
}

interface Matrix {
  readonly columns: readonly {
    readonly name: string;
    readonly direction: string;
    readonly count: number;
    readonly share: number;
  }[];
  readonly rows: readonly {
    readonly shortId: string;
    readonly identifier?: string;
    readonly title: string;
    readonly cells: readonly (readonly Relation[])[];
  }[];
  readonly total: number;
}

/** What the matrix of the window shows: the heads, and per row its element and the text of each link of each cell. */
interface Shown {
  readonly heads: readonly { readonly name: string; readonly count: string }[];
  readonly rows: readonly { readonly element: string; readonly cells: readonly (readonly string[])[] }[];
}

const shown = (window: Page): Promise<Shown> =>
  window.locator("table").evaluate((table): Shown => {
    const text = (element: Element | null): string =>
      (element?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      heads: [...table.querySelectorAll("thead th")].slice(1).map((head) => ({
        name: text(head.querySelector(".name")),
        count: text(head.querySelector(".count")),
      })),
      rows: [...table.querySelectorAll("tbody tr")].map((row) => ({
        element: text(row.querySelector("td.element")),
        cells: [...row.querySelectorAll("td.cell")].map((cell) =>
          [...cell.querySelectorAll(".relation")].map((relation) => text(relation)),
        ),
      })),
    };
  });

/** The label the buffers use: the identifier, else the short ID, else (a target that is not there) the UUID, then the title. */
const labelOf = (item: {
  readonly id?: string;
  readonly shortId?: string;
  readonly identifier?: string;
  readonly title?: string;
}): string => `${item.identifier ?? item.shortId ?? item.id ?? ""} ${item.title ?? ""}`.trim();

/** The same as the window shows, built from the output of the CLI: the label, the state of an end that is not there, "outdated". */
const expected = (matrix: Matrix): Shown => ({
  heads: matrix.columns.map((column) => ({
    name: column.name,
    count: `${String(column.count)} · ${String(Math.floor(column.share * 100 + 1e-9))} %`,
  })),
  rows: matrix.rows.map((row) => ({
    element: labelOf(row),
    cells: row.cells.map((cell) =>
      cell.map(
        (relation) =>
          `${labelOf(relation)}${relation.targetState === "available" ? "" : ` ${relation.targetState}`}${relation.outdated === true ? " outdated" : ""}`,
      ),
    ),
  })),
});

const matrixBy = async (running: RunningApp, input: unknown): Promise<Matrix> => {
  const result = await running.cli(["trace", "matrix", "--input", JSON.stringify(input)]);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Matrix;
};

/** Opens the command prompt, types `command` and runs the first candidate. */
const runCommand = async (window: Page, command: string): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+Shift+P");
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
};

/** Types `text` into the prompt `label` once it is asked for and presses Enter. */
const answer = async (window: Page, label: string, text: string): Promise<void> => {
  await expect(window.getByLabel("Minibuffer").locator("label")).toHaveText(label);
  await window.keyboard.type(text);
  await window.keyboard.press("Enter");
};

/** The list of the system requirements as the matrix of the task "alle System Requirements". */
const requirements = async (window: Page): Promise<void> => {
  await runCommand(window, "Filter list by type");
  await answer(window, "Type", "system-requirement");
  await expect(window.locator(".row")).toHaveCount(6);
};

const matrixOpen = async (window: Page, rows: number): Promise<void> => {
  await window.keyboard.press("ControlOrMeta+T");
  await expect(window.locator("tbody tr")).toHaveCount(rows);
};

const ALL_SRS = { selection: { where: { type: ["system-requirement"] } }, sort: DEFAULT_SORT };

test.describe("the traceability matrix on a fixture workspace", () => {
  let running: RunningApp;
  test.beforeEach(async () => {
    running = await launchApp({ fixture: "SR-125/matrix" });
    await listAll(running.window);
  });
  test.afterEach(async () => {
    await running.close();
  });

  test("[SR-125/AK1] Ctrl+T on a filtered list shows one row per list element in the order of the list, and Ctrl+T shows the list again", async () => {
    const { window } = running;
    await requirements(window);
    const listed = await window.locator(".row .title").allTextContents();
    await window.locator(".row").nth(2).click();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.locator(".row").first()).toBeVisible();
    await matrixOpen(window, 6);
    await expect(window.getByLabel("Modeline")).toContainText("type: system-requirement · matrix");
    await expect(window.getByLabel("Modeline")).toContainText("6 elements");
    const matrix = await shown(window);
    expect(matrix.rows.map((row) => row.element)).toEqual(
      (await matrixBy(running, ALL_SRS)).rows.map((row) => labelOf(row)),
    );
    // The titles are those of the list, in its order.
    expect(matrix.rows.map((row) => row.element.replace(/^\S+ /, ""))).toEqual(listed);
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator(".row")).toHaveCount(6);
    expect(await window.locator(".row .title").allTextContents()).toEqual(listed);
    await expect(window.locator("table")).toHaveCount(0);
  });

  test("[SR-125/AK2] the columns and cells of the window are those of trace matrix (SR-080/AK2)", async () => {
    const { window } = running;
    await requirements(window);
    await matrixOpen(window, 6);
    const cli = await matrixBy(running, ALL_SRS);
    expect(cli.columns.map((column) => column.name)).toEqual([
      "Refines",
      "Refined by",
      "Derives from",
      "Derived by",
      "Based on",
    ]);
    expect(await shown(window)).toEqual(expected(cli));
  });

  test("[SR-125/AK3] a row without a relation of a column has a gap in the accent colour, and each head says how many rows have one", async () => {
    const { window } = running;
    await requirements(window);
    await matrixOpen(window, 6);
    const cli = await matrixBy(running, ALL_SRS);
    const gaps = cli.rows.flatMap((row) => row.cells).filter((cell) => cell.length === 0).length;
    expect(gaps).toBeGreaterThan(0);
    await expect(window.locator("td.cell .gap")).toHaveCount(gaps);
    await expect(window.locator("td.cell .gap").first()).toHaveText("—");
    const colours = await window.evaluate(() => ({
      gap: getComputedStyle(document.querySelector("td.cell .gap") ?? document.body).color,
      text: getComputedStyle(document.querySelector("td.element") ?? document.body).color,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent-gap").trim(),
    }));
    expect(colours.gap).not.toBe(colours.text);
    expect(colours.accent).not.toBe("");
    expect((await shown(window)).heads).toEqual(expected(cli).heads);
    // The selection is every system requirement, so the heads count over six rows.
    expect(cli.total).toBe(6);
  });

  test("[SR-125/AK4] an outdated relation is marked outdated and one to a missing target missing, in its cell", async () => {
    const { window } = running;
    await requirements(window);
    await matrixOpen(window, 6);
    const cli = await matrixBy(running, ALL_SRS);
    const relations = cli.rows.flatMap((row) => row.cells.flat());
    const outdated = relations.filter((relation) => relation.outdated === true).length;
    const missing = relations.filter((relation) => relation.targetState === "missing").length;
    expect(outdated).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(0);
    await expect(window.locator("td.cell .outdated")).toHaveCount(outdated);
    await expect(window.locator("td.cell .state")).toHaveCount(missing);
    await expect(window.locator("td.cell .state").first()).toHaveText("missing");
    const colours = await window.evaluate(() => ({
      outdated: getComputedStyle(document.querySelector("td.cell .outdated") ?? document.body).color,
      text: getComputedStyle(document.querySelector("td.element") ?? document.body).color,
    }));
    expect(colours.outdated).not.toBe(colours.text);
  });

  test("[SR-125/AK5] Enter on a row opens its element; Right then Enter opens a link; a click opens a link; a missing link opens nothing", async () => {
    const { window } = running;
    await requirements(window);
    await matrixOpen(window, 6);
    const cli = await matrixBy(running, ALL_SRS);
    const first = cli.rows[0];
    expect(first).toBeDefined();
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(first?.title ?? "");
    // Back to the matrix: the buffer list brings it back with its row.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    await expect(window.locator("tbody tr")).toHaveCount(6);
    // The first link of the first row that has one.
    const at = cli.rows.findIndex((row) => row.cells.flat().length > 0);
    for (let step = 0; step < at; step += 1) {
      await window.keyboard.press("ArrowDown");
    }
    await window.keyboard.press("ArrowRight");
    const link = cli.rows[at]?.cells.flat()[0];
    await expect(window.locator(".current")).toHaveText(labelOf(link ?? {}));
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText(link?.title ?? "");
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    // A click on a link of a cell.
    await window.locator("td.cell .relation:not(.unavailable) [role=link]").first().click();
    await expect(window.locator("article h1")).toBeVisible();
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.press("Enter");
    // A missing target: Enter says why, nothing opens.
    await window.locator("td.cell .unavailable [role=link]").first().click();
    await expect(window.getByLabel("Minibuffer")).toContainText("is missing");
    await expect(window.locator("tbody tr")).toHaveCount(6);
  });

  test("[SR-125/AK6] the matrix of a package page and of a saved filter is what the CLI gives for the same selection", async () => {
    const { window } = running;
    // The package Stage 3: Ctrl+P, its title, Enter, Ctrl+T.
    await window.keyboard.press("ControlOrMeta+P");
    await window.keyboard.type("Stage 3");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Stage 3");
    await window.keyboard.press("Enter");
    await expect(window.locator("article h1")).toHaveText("Stage 3");
    await expect(window.locator(".members .row").first()).toBeVisible();
    await window.keyboard.press("ControlOrMeta+T");
    await expect(window.locator("tbody tr")).toHaveCount(5);
    await expect(window.getByLabel("Modeline")).toContainText("package: PKG-e0000000001 Stage 3 · matrix");
    const byPackage = await matrixBy(running, {
      selection: { package: "PKG-e0000000001" },
      sort: DEFAULT_SORT,
    });
    expect(byPackage.total).toBe(5);
    expect(await shown(window)).toEqual(expected(byPackage));
    // The saved filter "Stage SRs": the list of all elements, the filter, Ctrl+T; its own sort holds.
    await listAll(window);
    await runCommand(window, "Filter list by saved filter");
    await answer(window, "Filter", "Stage SRs");
    await expect(window.locator(".row")).toHaveCount(5);
    await matrixOpen(window, 5);
    const bySaved = await matrixBy(running, { selection: { filter: "Stage SRs" } });
    expect(bySaved.rows.map((row) => row.title)).toEqual(
      [...bySaved.rows.map((row) => row.title)].sort().reverse(),
    );
    expect(await shown(window)).toEqual(expected(bySaved));
    // The ids of a list give the same cells, too (what the neighbourhood of a later entry will send).
    const ids = await matrixBy(running, {
      selection: { ids: bySaved.rows.map((row) => row.shortId) },
      sort: [{ by: "title", order: "desc" }],
    });
    expect(ids.rows.map((row) => row.shortId)).toEqual(bySaved.rows.map((row) => row.shortId));
    expect(ids.columns).toEqual(bySaved.columns);
    expect(ids.rows.map((row) => row.cells)).toEqual(bySaved.rows.map((row) => row.cells));
  });

  test("[SR-125/AK1] a filter and a sort on the matrix keep the matrix and change its rows as they change the list", async () => {
    const { window } = running;
    await requirements(window);
    await matrixOpen(window, 6);
    await runCommand(window, "Filter list by text search");
    await answer(window, "Text", "wind");
    await expect(window.locator("tbody tr")).not.toHaveCount(6);
    const cli = await matrixBy(running, {
      selection: { where: { all: [{ type: ["system-requirement"] }, { text: "wind" }] } },
      sort: DEFAULT_SORT,
    });
    await expect(window.locator("tbody tr")).toHaveCount(cli.rows.length);
    expect(await shown(window)).toEqual(expected(cli));
    await runCommand(window, "Sort list");
    await answer(window, "Sort by", "Title descending");
    const sorted = await matrixBy(running, {
      selection: { where: { all: [{ type: ["system-requirement"] }, { text: "wind" }] } },
      sort: [{ by: "title", order: "desc" }],
    });
    await expect(window.getByLabel("Modeline")).toContainText("sorted by title descending · matrix");
    expect(await shown(window)).toEqual(expected(sorted));
    await runCommand(window, "Clear list filter");
    await expect(window.locator("tbody tr")).toHaveCount(6);
    await expect(window.getByLabel("Modeline")).toContainText("matrix");
  });

  test("the command prompt offers the matrix and the way back to the list, each with Ctrl+T", async () => {
    const { window } = running;
    await requirements(window);
    await runCommand(window, "traceability");
    await expect(window.locator("tbody tr")).toHaveCount(6);
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await window.keyboard.type("as list");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText("Show as list");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(/Ctrl\+T|⌘T/);
  });
});
