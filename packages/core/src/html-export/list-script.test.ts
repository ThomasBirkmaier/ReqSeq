// The list script of the HTML export (SR-233 AK1, AK5), run under happy-dom on a list as `list-page.ts` writes it:
// search, filters with their numbers, sorting with no value last, grouping, the chosen values as buttons, and Clear.
import type { HTMLElement, HTMLInputElement } from "happy-dom";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listScript } from "./list-script.js";

/** A row: identifier, title, the search text, the value indexes per filter and the ranks per column. */
const row = (id: string, title: string, f: number[][], s: (number | null)[]): string =>
  `<tr data-q="${id.toLowerCase()}\n${title.toLowerCase()}" data-f="${JSON.stringify(f).replaceAll('"', "&quot;")}" data-s="${JSON.stringify(s)}"><td>${id}</td><td>${title}</td></tr>`;

const SETTINGS = {
  columns: [{ label: "Identifier", total: true }, { label: "Title & <more>" }],
  filters: [
    { label: "Status", values: ["draft", "approved", "–"] },
    { label: "Packages", values: ["Display", "Sensor", "–"] },
  ],
};

// Titles rank B < A < none; SR-3 has no title rank. SR-2 is in both packages.
const PAGE = `<div class="rq-list" data-rq-list="${JSON.stringify(SETTINGS).replaceAll('"', "&quot;")}"><p class="rq-list-count">3 elements</p><table><thead><tr><th>Identifier</th><th>Title &amp; &lt;more&gt;</th></tr></thead><tbody>${[
  row("SR-1", "Alpha", [[0], [0]], [0, 1]),
  row("SR-2", "Beta", [[1], [0, 1]], [1, 0]),
  row("SR-3", "", [[0], [2]], [2, null]),
].join("")}</tbody></table></div>`;

/** A list with `rows` as `PAGE` has its. */
const list = (rows: readonly string[]): string =>
  PAGE.replace(/<tbody>[\s\S]*<\/tbody>/u, `<tbody>${rows.join("")}</tbody>`);

const page = (html = PAGE) => {
  const window = new Window();
  window.document.body.innerHTML = `${html}<p id="other">x</p>`;
  vi.stubGlobal("document", window.document);
  listScript();
  const box = window.document.querySelector(".rq-list") as unknown as HTMLElement;
  const one = (selector: string): HTMLElement => box.querySelector(selector) as unknown as HTMLElement;
  const field = (selector: string): HTMLInputElement =>
    box.querySelector(selector) as unknown as HTMLInputElement;
  const rows = (): string[] =>
    [...box.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td, th")].map((cell) => cell.textContent).join(" "),
    );
  const fire = (target: HTMLElement, type: string): void => {
    target.dispatchEvent(new window.Event(type, { bubbles: true }));
  };
  const toggle = (selector: string): void => {
    const input = field(selector);
    input.checked = !input.checked;
    fire(input, "change");
  };
  const search = (text: string): void => {
    const input = field(".rq-search");
    input.value = text;
    fire(input, "input");
  };
  const values = (chip: number): string[] =>
    [...box.querySelectorAll(`[data-chip="${String(chip)}"] label`)].map((l) => l.textContent);
  return { window, box, one, field, rows, fire, toggle, search, values };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list script (SR-233 AK1)", () => {
  it("adds the search field, the filters and the sort buttons, and searches identifier and title ignoring case", () => {
    const { box, one, rows, search, fire } = page();
    expect(one(".rq-search").getAttribute("aria-label")).toBe("Filter by identifier, short ID or title");
    expect([...box.querySelectorAll("th button")].map((b) => b.textContent)).toEqual([
      "Identifier",
      "Title & <more>",
    ]);
    expect(one(".rq-clear").hidden).toBe(true);
    search("ALP");
    expect(rows()).toEqual(["SR-1 Alpha"]);
    expect(one(".rq-list-count").textContent).toBe("1 of 3 elements");
    expect(one(".rq-clear").hidden).toBe(false);
    search(" sr- ");
    expect(one(".rq-list-count").textContent).toBe("3 elements");
    search("none");
    expect(rows()).toEqual([]);
    expect(one(".rq-list-count").textContent).toBe("0 of 3 elements");
    // A list without baselines: a change event of the search field changes nothing.
    fire(one(".rq-search"), "change");
    expect(rows()).toEqual([]);
  });

  it("filters with or within a filter and and between filters, each value with its number of rows", () => {
    const { window, one, rows, toggle, values, box } = page();
    // A value without rows is not offered: no row is without status.
    expect(values(0)).toEqual(["draft2", "approved1"]);
    expect(values(1)).toEqual(["Display2", "Sensor1", "–1"]);
    toggle('[data-filter="0"][data-value="1"]');
    expect(rows()).toEqual(["SR-2 Beta"]);
    // The redrawn box keeps the focus, for the next value by keyboard.
    expect(window.document.activeElement).toBe(box.querySelector('[data-filter="0"][data-value="1"]'));
    // The chip shows the number of its chosen values.
    expect(one('[data-chip="0"] summary').textContent).toBe("Status1");
    expect(one('[data-chip="0"]').classList.contains("rq-on")).toBe(true);
    // The numbers of the other filter count the rows this filter leaves.
    expect(values(1)).toEqual(["Display1", "Sensor1"]);
    toggle('[data-filter="0"][data-value="0"]');
    expect(rows()).toEqual(["SR-1 Alpha", "SR-2 Beta", "SR-3 "]);
    toggle('[data-filter="1"][data-value="1"]');
    expect(rows()).toEqual(["SR-2 Beta"]);
    expect([...box.querySelectorAll(".rq-tokens button")].map((b) => b.textContent)).toEqual([
      "Status: draft ×",
      "Status: approved ×",
      "Packages: Sensor ×",
    ]);
    // A chosen value stays offered when no row has it any more.
    toggle('[data-filter="0"][data-value="1"]');
    expect(rows()).toEqual([]);
    expect(values(0)).toEqual(["draft0", "approved1"]);
    one('.rq-tokens [data-remove="0"]').click();
    expect(rows()).toEqual(["SR-2 Beta"]);
    one('.rq-tokens [data-remove="1"]').click();
    expect(rows()).toEqual(["SR-1 Alpha", "SR-2 Beta", "SR-3 "]);
    expect(one(".rq-tokens").textContent).toBe("No filters.");
    expect(one(".rq-clear").hidden).toBe(true);
  });

  it("puts the number of rows in the search bar and closes an open menu on a click outside it and on Escape (#2138)", () => {
    const { window, box, one } = page();
    expect(one(".rq-qbar .rq-list-count").textContent).toBe("3 elements");
    const status = one('[data-chip="0"]');
    const group = one('[data-chip="group"]');
    const key = (k: string): void => {
      window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
    };
    status.setAttribute("open", "");
    // A click inside the menu keeps it open.
    one('[data-chip="0"] label').click();
    expect(status.hasAttribute("open")).toBe(true);
    // A click on another chip closes this one.
    group.setAttribute("open", "");
    one('[data-chip="group"] summary').click();
    expect(status.hasAttribute("open")).toBe(false);
    (window.document.getElementById("other") as unknown as HTMLElement).click();
    expect(group.hasAttribute("open")).toBe(false);
    status.setAttribute("open", "");
    key("a");
    expect(status.hasAttribute("open")).toBe(true);
    key("Escape");
    expect(status.hasAttribute("open")).toBe(false);
    expect(window.document.activeElement).toBe(box.querySelector('[data-chip="0"] summary'));
  });

  it("sorts by a column, no value last in both orders, and the identifier wholly reversed", () => {
    const { box, one, rows } = page();
    const head = (c: number): HTMLElement => one(`th button[data-sort="${String(c)}"]`);
    const sorted = (c: number): string | null =>
      (box.querySelectorAll("th")[c] as unknown as HTMLElement).getAttribute("aria-sort");
    head(1).click();
    expect(rows()).toEqual(["SR-2 Beta", "SR-1 Alpha", "SR-3 "]);
    expect(sorted(1)).toBe("ascending");
    head(1).click();
    expect(rows()).toEqual(["SR-1 Alpha", "SR-2 Beta", "SR-3 "]);
    expect(sorted(1)).toBe("descending");
    head(0).click();
    head(0).click();
    expect(rows()).toEqual(["SR-3 ", "SR-2 Beta", "SR-1 Alpha"]);
    expect(sorted(1)).toBeNull();
    expect(sorted(0)).toBe("descending");
  });

  it("groups by a filter in the order of its values, a row with several values in each", () => {
    const { box, one, field, rows, toggle, search } = page();
    toggle('[data-group="1"]');
    expect(rows()).toEqual([
      "Packages: Display · 2",
      "SR-1 Alpha",
      "SR-2 Beta",
      "Packages: Sensor · 1",
      "SR-2 Beta",
      "Packages: – · 1",
      "SR-3 ",
    ]);
    expect(box.querySelector("tbody th")?.getAttribute("colspan")).toBe("2");
    // A group without rows is left out.
    search("alpha");
    expect(rows()).toEqual(["Packages: Display · 1", "SR-1 Alpha"]);
    expect(one(".rq-tokens").textContent).toBe("Grouped by Packages ×");
    expect(one('[data-chip="group"] summary').textContent).toBe("Group1");
    expect(one('[data-chip="group"]').hasAttribute("open")).toBe(false);
    one('.rq-tokens [data-remove="group"]').click();
    expect(rows()).toEqual(["SR-1 Alpha"]);
    expect(field('[data-group="-1"]').checked).toBe(true);
    toggle('[data-group="0"]');
    toggle('[data-filter="1"][data-value="0"]');
    one(".rq-clear").click();
    expect(rows()).toEqual(["SR-1 Alpha", "SR-2 Beta", "SR-3 "]);
    expect(field(".rq-search").value).toBe("");
    expect(field('[data-group="-1"]').checked).toBe(true);
  });

  it("keeps the order of the page among equal values and among rows without a value", () => {
    const { one, rows } = page(
      list([
        row("SR-1", "", [[0], [2]], [0, null]),
        row("SR-2", "Beta", [[0], [2]], [1, 0]),
        row("SR-3", "", [[0], [2]], [2, null]),
        row("SR-4", "Beta", [[0], [2]], [3, 0]),
      ]),
    );
    one('th button[data-sort="1"]').click();
    expect(rows()).toEqual(["SR-2 Beta", "SR-4 Beta", "SR-1 ", "SR-3 "]);
    one('th button[data-sort="1"]').click();
    expect(rows()).toEqual(["SR-2 Beta", "SR-4 Beta", "SR-1 ", "SR-3 "]);
  });

  it("counts a list of one element", () => {
    const { one } = page(list([row("SR-1", "Alpha", [[0], [0]], [0, 0])]));
    expect(one(".rq-list-count").textContent).toBe("1 element");
  });

  it("leaves the rows as they are on a click or change elsewhere", () => {
    const { window, box, rows, fire, one } = page();
    one('th button[data-sort="1"]').click();
    const before = rows();
    (window.document.getElementById("other") as unknown as HTMLElement).click();
    one(".rq-list-count").click();
    fire(one(".rq-search"), "change");
    expect(rows()).toEqual(before);
    expect(box.querySelectorAll("th[aria-sort]")).toHaveLength(1);
  });
});
