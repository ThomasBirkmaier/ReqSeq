// The script of the lists of the HTML export, `assets/list.js` (SR-233 AK1, AK5; a classic script, as `page-script.ts`
// says why). Without it the list is the whole table (`list-page.ts`); with it, the list gets above the table:
//
// - a search field that keeps the rows whose identifier, short ID or title holds the typed text, ignoring case (each
//   row's `data-q`, folded as the export folded it: NFC, lower case);
// - a chip per filter (`data-rq-list`) that lists its values with the number of rows each would show with the search
//   and the other filters as they are; several values of one filter match any of them, several filters all of them;
// - a chip "Group" that groups the rows by one filter, the groups in the order of its values, a row with several
//   values in each of them;
// - the chosen values and grouping as buttons that remove them, and "Clear", which removes everything;
// - a button in each column head that sorts by it (`data-s`, the ranks of SR-075 AK1), again for descending: no value
//   stays last in both orders, except in a column marked `total` (the identifier), whose descending order is the
//   ascending one reversed. Rows of equal rank keep the order of the page.

// Core has no DOM types (its `lib` is ES only), so the script takes what it uses from `globalThis` as these. The page
// holds every element the script asks for with `querySelector`.
interface Node {
  readonly dataset: Record<string, string | undefined>;
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  checked: boolean;
  value: string;
  readonly classList: { toggle: (name: string, on: boolean) => void };
  querySelector: (selector: string) => Node;
  querySelectorAll: (selector: string) => Iterable<Node>;
  closest: (selector: string) => Node | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  insertAdjacentHTML: (position: string, html: string) => void;
  addEventListener: (type: string, listener: (event: { readonly target: unknown }) => void) => void;
  cloneNode: (deep: boolean) => Node;
  replaceChildren: (...nodes: Node[]) => void;
}
interface Browser {
  readonly document: {
    querySelectorAll: (selector: string) => Iterable<Node>;
    createElement: (name: string) => Node;
  };
}

/** What `data-rq-list` holds (`list-page.ts`). */
interface Settings {
  readonly columns: readonly { readonly label: string; readonly total?: true }[];
  readonly filters: readonly { readonly label: string; readonly values: readonly string[] }[];
}

/** `assets/list.js` (see the file comment). */
export function listScript(): void {
  const { document } = globalThis as unknown as Browser;
  const escape = (text: string): string => text.replace(/[&<>"']/gu, (c) => `&#${String(c.charCodeAt(0))};`);
  const counted = (n: number): string => `${String(n)} ${n === 1 ? "element" : "elements"}`;

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
    }));
    type Row = (typeof rows)[number];
    const filters = settings.filters.map((filter, f) => ({ ...filter, f, chosen: new Set<number>() }));
    type Filter = (typeof filters)[number];
    const state: { q: string; sort: number; dir: number; group: Filter | undefined } = {
      q: "",
      sort: -1,
      dir: 1,
      group: undefined,
    };
    const chips = filters
      .map(
        ({ label, f }) =>
          `<details class="rq-chip" data-chip="${String(f)}"><summary></summary><div class="rq-chip-values" role="group" aria-label="${escape(label)}"></div></details>`,
      )
      .join("");
    const groups = [{ label: "No grouping", f: -1 }, ...filters]
      .map(
        ({ label, f }) =>
          `<label><input type="radio" name="rq-group" data-group="${String(f)}"${f === -1 ? " checked" : ""}>${escape(label)}</label>`,
      )
      .join("");
    count.insertAdjacentHTML(
      "beforebegin",
      `<div class="rq-list-bar not-content"><input type="search" class="rq-search" autocomplete="off" placeholder="Filter by identifier, short ID or title" aria-label="Filter by identifier, short ID or title">${chips}<details class="rq-chip" data-chip="group"><summary>Group</summary><div class="rq-chip-values" role="group" aria-label="Group">${groups}</div></details><button type="button" class="rq-clear" hidden>Clear</button></div><div class="rq-tokens not-content"></div>`,
    );
    const heads = [...box.querySelectorAll("thead th")];
    heads.forEach((th, c) => {
      th.innerHTML = `<button type="button" data-sort="${String(c)}">${escape(th.textContent)}</button>`;
    });
    const search = box.querySelector(".rq-search");
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
        chip.querySelector("summary").textContent =
          chosen.size === 0 ? label : `${label} ${String(chosen.size)}`;
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
      if (state.group !== undefined) {
        const label = `Grouped by ${state.group.label}`;
        shown.push(
          `<button type="button" data-remove="group" aria-label="Remove ${escape(label)}">${escape(label)} ×</button>`,
        );
      }
      tokens.innerHTML = shown.join("");
      clear.hidden = shown.length === 0 && state.q === "";
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
      state.q = search.value.normalize("NFC").toLowerCase();
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
      } else if (target.dataset["group"] !== undefined) {
        setGroup(Number(target.dataset["group"]));
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
      } else {
        return;
      }
      draw();
    });
    draw();
  };

  for (const box of document.querySelectorAll(".rq-list[data-rq-list]")) {
    setUp(box);
  }
}
