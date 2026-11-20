// The script of the lists of the HTML export, `assets/list.js` (SR-233 AK1, AK5; a classic script, as `page-script.ts`
// says why). Without it the list is the whole table (`list-page.ts`); with it, the list gets above the table:
//
// - a search bar that keeps the rows whose identifier, short ID or title holds the typed text, ignoring case (each
//   row's `data-q`, folded as the export folded it: NFC, lower case), with the number of rows shown and "Clear",
//   which removes the search, the filters and the grouping;
// - a chip per filter (`data-rq-list`) whose menu lists its values with the number of rows each would show with the
//   search and the other filters as they are; several values of one filter match any of them, several filters all
//   of them;
// - a chip "Group" that groups the rows by one filter, the groups in the order of its values, a row with several
//   values in each of them;
// - a line with the chosen values, the grouping and the chosen baseline as buttons that remove them, "No filters."
//   without one;
// - a button in each column head that sorts by it (`data-s`, the ranks of SR-075 AK1), again for descending: no value
//   stays last in both orders, except in a column marked `total` (the identifier), whose descending order is the
//   ascending one reversed. Rows of equal rank keep the order of the page;
// - when the list compares with baselines (`compare`, SR-233 AK2), a chip "Compare" to choose the baseline, "No
//   baseline" at first: with a baseline chosen, the last column (written hidden) shows each row's change since it
//   (`data-b`) and sorts in the order of its values, and a chip filters by it; with none, the column and the chip are
//   hidden and their choice is cleared. The chip offers no grouping.
//
// An open menu of a chip closes on a click outside it and on Escape, which puts the focus on its chip when the focus
// was in its menu (#2138).

// Core has no DOM types (its `lib` is ES only), so the script takes what it uses from `globalThis` as these. The page
// holds every element the script asks for with `querySelector`.
interface Node {
  readonly dataset: Record<string, string | undefined>;
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  readonly isConnected: boolean;
  checked: boolean;
  value: string;
  readonly classList: { toggle: (name: string, on: boolean) => void };
  querySelector: (selector: string) => Node;
  querySelectorAll: (selector: string) => Iterable<Node>;
  closest: (selector: string) => Node | null;
  setAttribute: (name: string, value: string) => void;
  before: (...nodes: Node[]) => void;
  removeAttribute: (name: string) => void;
  insertAdjacentHTML: (position: string, html: string) => void;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  cloneNode: (deep: boolean) => Node;
  replaceChildren: (...nodes: Node[]) => void;
  focus: () => void;
}
interface Event {
  readonly target: unknown;
  readonly key?: string;
}
interface Browser {
  readonly document: {
    querySelectorAll: (selector: string) => Iterable<Node>;
    createElement: (name: string) => Node;
    addEventListener: (type: string, listener: (event: Event) => void) => void;
    readonly activeElement: Node | null;
  };
}

/** What `data-rq-list` holds (`list-page.ts`). */
interface Settings {
  readonly columns: readonly { readonly label: string; readonly total?: true }[];
  readonly filters: readonly { readonly label: string; readonly values: readonly string[] }[];
  readonly compare?: {
    readonly label: string;
    readonly baselines: readonly string[];
    readonly values: readonly string[];
  };
}

/** `assets/list.js` (see the file comment). */
export function listScript(): void {
  const { document } = globalThis as unknown as Browser;
  const escape = (text: string): string => text.replace(/[&<>"']/gu, (c) => `&#${String(c.charCodeAt(0))};`);
  const counted = (n: number): string => `${String(n)} ${n === 1 ? "element" : "elements"}`;
  const caret =
    '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17 9.17a1 1 0 0 0-1.41 0L12 12.71 8.46 9.17a1 1 0 1 0-1.41 1.42l4.24 4.24a1 1 0 0 0 1.42 0L17 10.59a1 1 0 0 0 0-1.42Z"/></svg>';
  const magnifier =
    '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.71 20.29 18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/></svg>';
  /** A chip `data-chip="<id>"` with the menu `values`, labelled `label`. */
  const chipOf = (id: string, label: string, values: string, alt = false): string =>
    `<details class="rq-chip${alt ? " rq-chip-alt" : ""}" data-chip="${id}"><summary></summary><div class="rq-chip-values" role="group" aria-label="${escape(label)}">${values}</div></details>`;
  /** The face of a chip: its label, the number of its chosen values (none: empty) and the mark of its menu. */
  const face = (label: string, chosen: number): string =>
    `${escape(label)}${chosen === 0 ? "" : ` <span class="rq-n">${String(chosen)}</span>`}${caret}`;

  const setUp = (box: Node): void => {
    const settings = JSON.parse(String(box.dataset["rqList"])) as Settings;
    const tbody = box.querySelector("tbody");
    const count = box.querySelector(".rq-list-count");
    const rows = [...tbody.querySelectorAll("tr")].map((tr, index) => ({
      tr,
      index,
      q: String(tr.dataset["q"]),
      f: JSON.parse(String(tr.dataset["f"])) as number[][],
      s: JSON.parse(String(tr.dataset["s"])) as (number | null)[],
      b: JSON.parse(tr.dataset["b"] ?? "[]") as number[],
    }));
    type Row = (typeof rows)[number];
    const comparing = settings.compare;
    const filters = [
      ...settings.filters,
      ...(comparing === undefined ? [] : [{ label: comparing.label, values: comparing.values }]),
    ].map((filter, f) => ({ ...filter, f, chosen: new Set<number>() }));
    type Filter = (typeof filters)[number];
    // The filter and the column of the change since the chosen baseline, the last of each.
    const change = comparing === undefined ? undefined : filters[filters.length - 1];
    const changeColumn = settings.columns.length - 1;
    for (const row of rows) {
      row.f.push([]);
    }
    const state: { q: string; sort: number; dir: number; group: Filter | undefined; baseline: number } = {
      q: "",
      sort: -1,
      dir: 1,
      group: undefined,
      baseline: -1,
    };
    const chips = filters.map(({ label, f }) => chipOf(String(f), label, "")).join("");
    const groups = [{ label: "No grouping", f: -1 }, ...filters.filter((filter) => filter !== change)]
      .map(
        ({ label, f }) =>
          `<label><input type="radio" name="rq-group" data-group="${String(f)}"${f === -1 ? " checked" : ""}>${escape(label)}</label>`,
      )
      .join("");
    const choice =
      comparing === undefined
        ? ""
        : chipOf(
            "compare",
            "Compare with baseline",
            ["No baseline", ...comparing.baselines]
              .map(
                (name, b) =>
                  `<label><input type="radio" name="rq-baseline" data-baseline="${String(b - 1)}"${b === 0 ? " checked" : ""}>${escape(name)}</label>`,
              )
              .join(""),
            true,
          );
    count.insertAdjacentHTML(
      "beforebegin",
      `<div class="rq-qbar not-content">${magnifier}<input type="search" class="rq-search" autocomplete="off" placeholder="Filter by identifier, short ID or title" aria-label="Filter by identifier, short ID or title"><button type="button" class="rq-clear" hidden>Clear</button></div><div class="rq-pills not-content"><span class="rq-pg">${chips}</span><span class="rq-pg rq-pg-r">${choice}${chipOf("group", "Group", groups, true)}</span></div><div class="rq-tokens not-content"></div>`,
    );
    // The number of rows stands in the search bar, before "Clear".
    box.querySelector(".rq-clear").before(count);
    const heads = [...box.querySelectorAll("thead th")];
    heads.forEach((th, c) => {
      th.innerHTML = `<button type="button" data-sort="${String(c)}">${escape(th.textContent)}</button>`;
    });
    const search = box.querySelector(".rq-search");
    if (change !== undefined) {
      box.querySelector(`[data-chip="${String(change.f)}"]`).hidden = true;
    }

    /** Shows the change since baseline `b` (-1: none) in its column and the filter `filter` (see the file comment). */
    const setBaseline = (filter: Filter, b: number): void => {
      filter.chosen.clear();
      state.baseline = b;
      for (const radio of box.querySelectorAll("[data-baseline]")) {
        radio.checked = Number(radio.dataset["baseline"]) === b;
      }
      const on = b >= 0;
      box.querySelector(`[data-chip="${String(filter.f)}"]`).hidden = !on;
      // The list has the column of the change as its last.
      box.querySelector("thead th:last-child").hidden = !on;
      if (!on && state.sort === changeColumn) {
        state.sort = -1;
      }
      for (const row of rows) {
        const value = on ? row.b[b] : undefined;
        row.f[filter.f] = value === undefined ? [] : [value];
        row.s[changeColumn] = value ?? null;
        const cell = row.tr.querySelector("td:last-child");
        cell.hidden = !on;
        cell.textContent = value === undefined ? "" : String(filter.values[value]);
      }
    };
    const unsetBaseline = (): void => {
      if (change !== undefined) {
        setBaseline(change, -1);
      }
    };
    const clear = box.querySelector(".rq-clear");
    const tokens = box.querySelector(".rq-tokens");

    /** Whether `row` passes the search and every filter but `skip`. */
    const passes = (row: Row, skip: Filter | undefined): boolean =>
      row.q.includes(state.q) &&
      filters.every(
        (filter) =>
          filter === skip ||
          filter.chosen.size === 0 ||
          row.f[filter.f]?.some((v) => filter.chosen.has(v)) === true,
      );
    /** How two rows compare under the chosen sort. */
    const compare = (a: Row, b: Row): number => {
      const x = a.s[state.sort];
      const y = b.s[state.sort];
      if (settings.columns[state.sort]?.total !== true && (x === null || y === null)) {
        return x === y ? a.index - b.index : x === null ? 1 : -1;
      }
      return (Number(x) - Number(y)) * state.dir || a.index - b.index;
    };

    const drawFilters = (): void => {
      for (const filter of filters) {
        const { label, f, chosen } = filter;
        const chip = box.querySelector(`[data-chip="${String(f)}"]`);
        const hits = filter.values.map(() => 0);
        for (const row of rows) {
          if (passes(row, filter)) {
            row.f[f]?.forEach((v) => {
              hits[v] = Number(hits[v]) + 1;
            });
          }
        }
        chip.classList.toggle("rq-on", chosen.size > 0);
        chip.querySelector("summary").innerHTML = face(label, chosen.size);
        chip.querySelector(".rq-chip-values").innerHTML = filter.values
          .map((value, v) =>
            hits[v] === 0 && !chosen.has(v)
              ? ""
              : `<label><input type="checkbox" data-filter="${String(f)}" data-value="${String(v)}"${chosen.has(v) ? " checked" : ""}><span>${escape(value)}</span><span class="rq-n">${String(hits[v])}</span></label>`,
          )
          .join("");
      }
    };

    const drawTokens = (): void => {
      const shown = filters.flatMap(({ label, f, values, chosen }) =>
        values.flatMap((value, v) =>
          chosen.has(v)
            ? [
                `<button type="button" data-remove="${String(f)}" data-value="${String(v)}" aria-label="Remove ${escape(`${label}: ${value}`)}">${escape(`${label}: ${value}`)} ×</button>`,
              ]
            : [],
        ),
      );
      const token = (what: string, label: string): string =>
        `<button type="button" data-remove="${what}" aria-label="Remove ${escape(label)}">${escape(label)} ×</button>`;
      if (state.group !== undefined) {
        shown.push(token("group", `Grouped by ${state.group.label}`));
      }
      const baseline = comparing?.baselines[state.baseline];
      if (baseline !== undefined) {
        shown.push(token("baseline", `Compared with ${baseline}`));
      }
      tokens.innerHTML = shown.length === 0 ? '<span class="rq-hint">No filters.</span>' : shown.join("");
      clear.hidden = shown.length === 0 && state.q === "";
      const group = box.querySelector('[data-chip="group"]');
      group.classList.toggle("rq-on", state.group !== undefined);
      group.querySelector("summary").innerHTML = face("Group", state.group === undefined ? 0 : 1);
      if (comparing !== undefined) {
        const compare = box.querySelector('[data-chip="compare"]');
        compare.classList.toggle("rq-on", baseline !== undefined);
        compare.querySelector("summary").innerHTML = face("Compare", baseline === undefined ? 0 : 1);
      }
    };

    const draw = (): void => {
      const visible = rows.filter((row) => passes(row, undefined));
      const ordered = state.sort < 0 ? visible : [...visible].sort(compare);
      const nodes: Node[] = [];
      const group = state.group;
      if (group === undefined) {
        nodes.push(...ordered.map((row) => row.tr));
      } else {
        const used = new Set<Row>();
        group.values.forEach((value, v) => {
          const members = ordered.filter((row) => row.f[group.f]?.includes(v) === true);
          if (members.length > 0) {
            const head = document.createElement("tr");
            head.innerHTML = `<th scope="colgroup" colspan="${String(settings.columns.length)}">${escape(`${group.label}: ${value} · ${String(members.length)}`)}</th>`;
            head.setAttribute("class", "rq-group");
            nodes.push(head);
            for (const row of members) {
              nodes.push(used.has(row) ? row.tr.cloneNode(true) : row.tr);
              used.add(row);
            }
          }
        });
      }
      tbody.replaceChildren(...nodes);
      count.textContent =
        visible.length === rows.length
          ? counted(rows.length)
          : `${String(visible.length)} of ${counted(rows.length)}`;
      heads.forEach((th, c) => {
        if (c === state.sort) {
          th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
        } else {
          th.removeAttribute("aria-sort");
        }
      });
      drawFilters();
      drawTokens();
    };

    const setGroup = (group: number): void => {
      state.group = filters[group];
      for (const radio of box.querySelectorAll("[data-group]")) {
        radio.checked = Number(radio.dataset["group"]) === group;
      }
    };

    search.addEventListener("input", () => {
      state.q = search.value.trim().normalize("NFC").toLowerCase();
      draw();
    });
    box.addEventListener("change", (event) => {
      const target = event.target as Node;
      const filter = filters[Number(target.dataset["filter"])];
      if (filter !== undefined) {
        const value = Number(target.dataset["value"]);
        if (target.checked) {
          filter.chosen.add(value);
        } else {
          filter.chosen.delete(value);
        }
        draw();
        // The redraw replaced the box just toggled: focus its new one, which stays unless no row has its value.
        for (const input of box.querySelectorAll(
          `[data-filter="${String(filter.f)}"][data-value="${String(value)}"]`,
        )) {
          input.focus();
        }
      } else if (target.dataset["group"] !== undefined) {
        setGroup(Number(target.dataset["group"]));
        draw();
      } else if (change !== undefined && target.dataset["baseline"] !== undefined) {
        setBaseline(change, Number(target.dataset["baseline"]));
        draw();
      }
    });
    box.addEventListener("click", (event) => {
      const target = event.target as Node;
      const sort = target.closest("[data-sort]");
      const remove = target.closest("[data-remove]");
      if (sort !== null) {
        const column = Number(sort.dataset["sort"]);
        state.dir = state.sort === column ? -state.dir : 1;
        state.sort = column;
      } else if (remove !== null) {
        const what = remove.dataset["remove"];
        if (what === "group") {
          setGroup(-1);
        } else if (what === "baseline") {
          unsetBaseline();
        } else {
          filters[Number(what)]?.chosen.delete(Number(remove.dataset["value"]));
        }
      } else if (target.closest(".rq-clear") !== null) {
        state.q = "";
        search.value = "";
        for (const filter of filters) {
          filter.chosen.clear();
        }
        setGroup(-1);
        unsetBaseline();
      } else {
        return;
      }
      draw();
    });
    draw();
  };

  /** Closes each open menu of a chip but `keep`; one that held `focus` puts the focus on its chip. */
  const close = (keep: Node | null, focus: Node | null = null): void => {
    for (const chip of document.querySelectorAll(".rq-list details.rq-chip[open]")) {
      if (chip !== keep) {
        chip.removeAttribute("open");
        if (focus?.closest(".rq-chip") === chip) {
          chip.querySelector("summary").focus();
        }
      }
    }
  };
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    // A click on a value of a menu redraws the menu, so its target can have left the page: it was inside.
    if (target.isConnected) {
      close(target.closest(".rq-chip"));
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close(null, document.activeElement);
    }
  });

  for (const box of document.querySelectorAll(".rq-list[data-rq-list]")) {
    setUp(box);
  }
}
