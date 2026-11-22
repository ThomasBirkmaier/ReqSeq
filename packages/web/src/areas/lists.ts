// Lists (`#/l/...`): every element, the elements of a type or a package, a saved filter, a perspective, and the
// search. Each list can be narrowed by facets (the values `element.facets` offers), sorted and grouped by what
// `element.list` and `element.search` take, and saved as a filter or a perspective; a saved one can be changed,
// renamed and deleted. What a list shows besides its base lives in the parameters of its route (`list-state.ts`).
//
// Routes: `#/l/all`, `#/l/type/<type key>`, `#/l/package/<short ID>`, `#/l/filter/<name>`,
// `#/l/perspective/<name>`, `#/l/search?q=<words>`, each with the parameters of `list-state.ts`.
import "../css/lists.css";
import type { InputOf, OutputOf } from "../api.js";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { announce, h } from "../dom.js";
import { addRailSection, errorBox, frame, prepareRail } from "../layout.js";
import type { Condition, FacetKey, FacetValue, ListState, SortKey } from "../list-state.js";
import {
  allOf,
  changesList,
  isPicked,
  parseState,
  pickConditions,
  queryOf,
  toggle,
  withoutPicks,
} from "../list-state.js";
import { statusPill, verificationMark } from "../marks.js";
import {
  cap,
  packageWord,
  propDef,
  propKey,
  sentence,
  statusName,
  typeDef,
  typeName,
  typePlural,
  typesWith,
} from "../meaning.js";
import { swap } from "../motion.js";
import { PAGE, allPages } from "../pages.js";
import type { Route } from "../router.js";
import { addRoute, addTitle, hashOf, isCurrent } from "../router.js";
import {
  el,
  hasVariants,
  refOf,
  shownId,
  store,
  variantName,
  verificationOf,
  viewSelection,
} from "../store.js";

type Selection = NonNullable<InputOf<"element.list">["selection"]>;
type Facets = OutputOf<"element.facets">;
type SavedFilter = OutputOf<"filter.list">["filters"][number];
type Perspective = OutputOf<"perspective.list">["perspectives"][number];
type Group = NonNullable<OutputOf<"element.list">["groups"]>[number];
type StoredSort = NonNullable<SavedFilter["sort"]>[number];
type Marks = NonNullable<OutputOf<"element.search">["hits"][number]["titleMarks"]>;

/** The most search hits a list shows: they come best first, so more words narrow it instead. */
const SEARCH_MOST = 2000;
const SEARCH_PAGE = 500;
/** How many values of a facet show before "more". */
const FACET_HEAD = 8;

// ---------- What every list page reads: saved filters, perspectives, the facets of the workspace ----------

interface Saved {
  readonly epoch: number;
  readonly view: string;
  readonly filters: readonly SavedFilter[];
  readonly perspectives: readonly Perspective[];
  readonly facets: Facets;
}

let saved: Saved | undefined;
let reading: { readonly key: string; readonly data: Promise<Saved> } | undefined;

/** The saved filters, perspectives and facets of the workspace, read once per load of the store and view. */
export async function savedData(): Promise<Saved> {
  if (saved?.epoch === store.epoch && saved.view === store.view) {
    return saved;
  }
  const key = `${String(store.epoch)}:${store.view}`;
  if (reading?.key !== key) {
    const epoch = store.epoch;
    const view = store.view;
    const read = Promise.all([
      call("filter.list"),
      call("perspective.list"),
      call("element.facets", { selection: viewSelection() }),
    ]).then(([f, p, facets]) => ({ epoch, view, filters: f.filters, perspectives: p.perspectives, facets }));
    reading = { key, data: read };
    void read
      .catch(() => undefined)
      .finally(() => {
        if (reading?.data === read) {
          reading = undefined;
        }
      });
  }
  const read = await reading.data;
  if (read.epoch === store.epoch && read.view === store.view) {
    saved = read;
  }
  return read;
}

/** After the page saved, renamed or deleted something: read again. */
function forgetSaved(): void {
  saved = undefined;
  reading = undefined;
}

const sameName = (a: string, b: string): boolean =>
  a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

const filterNamed = (data: Saved, name: string | undefined): SavedFilter | undefined =>
  name === undefined ? undefined : data.filters.find((f) => sameName(f.name, name));
const perspectiveNamed = (data: Saved, name: string | undefined): Perspective | undefined =>
  name === undefined ? undefined : data.perspectives.find((p) => sameName(p.name, name));

const packagesFacet = (facets: Facets): Facets["properties"][number] | undefined => {
  const key = propKey(store.mm, "packages");
  return key === undefined ? undefined : facets.properties.find((p) => p.key === key);
};

// ---------- The base of a list ----------

type BaseKind = "all" | "type" | "package" | "filter" | "perspective" | "search";

interface Base {
  readonly kind: BaseKind;
  /** The second part of the route: the type key, package, name; empty for all and search. */
  readonly arg: string;
  readonly title: string;
  /** A line under the title: the description of a saved filter or perspective, the ID of a package. */
  readonly note?: string;
  /** What `element.list` and `element.facets` select, before the picks. */
  readonly selection: Selection;
  /** The perspective `element.list` lists as. */
  readonly perspective?: string;
  /** The conditions of the base as a saved filter holds them. */
  readonly where: readonly Condition[];
  /** The view a saved filter of this base keeps. */
  readonly view?: string;
  /** The saved filter a perspective of this base uses, and the conditions it adds to it. */
  readonly perspectiveFilter?: string;
  readonly perspectiveWhere: readonly Condition[];
  readonly storedSort?: readonly StoredSort[];
  readonly storedGroup?: string;
}

const KINDS: readonly BaseKind[] = ["all", "type", "package", "filter", "perspective", "search"];
const isKind = (part: string | undefined): part is BaseKind => KINDS.includes(part as BaseKind);

const TITLES: Readonly<Record<BaseKind, (arg: string, route: Route) => string>> = {
  all: () => "All elements",
  type: (arg) => (typeDef(store.mm, arg) === undefined ? arg : typePlural(store.mm, arg)),
  package: (arg) => el(arg)?.title ?? arg,
  filter: (arg) => arg,
  perspective: (arg) => arg,
  search: (_, route) => {
    const q = route.params.get("q") ?? "";
    return q.trim() === "" ? "Search" : `Search for “${q}”`;
  },
};

/** What a way back and the rail call the list of `route`; also when the list itself cannot be read. */
function titleOfList(route: Route): string | undefined {
  const [, kind, arg = ""] = route.parts;
  return isKind(kind) ? TITLES[kind](arg, route) : undefined;
}

type Plain = Pick<Base, "kind" | "arg" | "title">;

/** How each kind of list finds its base: the base, or a sentence why there is none. */
const BASES: Readonly<Record<BaseKind, (plain: Plain, data: Saved, state: ListState) => Base | string>> = {
  all: (plain) => ({ ...plain, selection: {}, where: [], perspectiveWhere: [] }),
  type: (plain) => {
    if (typeDef(store.mm, plain.arg) === undefined) {
      return `The metamodel has no type ${plain.arg}.`;
    }
    const where: Condition = { type: [plain.arg] };
    return { ...plain, selection: { where }, where: [where], perspectiveWhere: [where] };
  },
  package: (plain) => {
    const e = el(plain.arg);
    if (e === undefined) {
      return `There is no element ${plain.arg}.`;
    }
    const where: Condition = { package: e.id };
    return {
      ...plain,
      note: shownId(e),
      selection: { package: e.id },
      where: [where],
      perspectiveWhere: [where],
    };
  },
  filter: (plain, data) => {
    const f = filterNamed(data, plain.arg);
    if (f === undefined) {
      return `There is no saved filter named “${plain.arg}”.`;
    }
    return {
      ...plain,
      title: f.name,
      ...(f.description === undefined ? {} : { note: f.description }),
      selection: { filter: f.name },
      where: [f.where],
      ...(f.view === undefined ? {} : { view: f.view }),
      perspectiveFilter: f.name,
      perspectiveWhere: [],
      ...(f.sort === undefined ? {} : { storedSort: f.sort }),
    };
  },
  perspective: (plain, data) => {
    const p = perspectiveNamed(data, plain.arg);
    if (p === undefined) {
      return `There is no perspective named “${plain.arg}”.`;
    }
    const used = filterNamed(data, p.filter);
    return {
      ...plain,
      title: p.name,
      ...(p.description === undefined ? {} : { note: p.description }),
      selection: { ...(p.filter === undefined ? {} : { filter: p.filter }), where: p.where },
      perspective: p.name,
      where: [p.where, ...(used === undefined ? [] : [used.where])],
      ...(used?.view === undefined ? {} : { view: used.view }),
      ...(p.filter === undefined ? {} : { perspectiveFilter: p.filter }),
      perspectiveWhere: [p.where],
      ...(p.sort === undefined ? {} : { storedSort: p.sort }),
      ...(p.group === undefined ? {} : { storedGroup: p.group }),
    };
  },
  search: (plain, _, state) => {
    const where: Condition[] = state.query === undefined ? [] : [{ text: state.query }];
    return { ...plain, selection: {}, where, perspectiveWhere: where };
  },
};

/** The base of `route`, or a sentence why there is none. */
function baseOf(route: Route, data: Saved, state: ListState): Base | string {
  const [, kind, arg = ""] = route.parts;
  if (!isKind(kind)) {
    return "This list does not exist.";
  }
  return BASES[kind]({ kind, arg, title: TITLES[kind](arg, route) }, data, state);
}

/** The selection of `base` with the picks of `state` (`except` leaves one facet out), in the chosen view. */
function selectionOf(base: Base, state: ListState, except?: FacetKey): Selection {
  const picks = pickConditions(state, except);
  const where = base.selection.where === undefined ? picks : [base.selection.where, ...picks];
  return {
    ...viewSelection(),
    ...base.selection,
    ...(where.length === 0 ? {} : { where: allOf(where) }),
  };
}

// ---------- Reading the rows ----------

interface Row {
  readonly id: string;
  readonly shortId: string;
  readonly identifier?: string;
  readonly title: string;
  readonly type?: string | undefined;
  readonly status?: string | undefined;
  readonly depth?: number;
  readonly titleMarks?: Marks;
  readonly snippet?: { readonly text: string; readonly marks?: Marks };
}

interface Rows {
  readonly rows: readonly Row[];
  /** Elements (or hits), each once. */
  readonly total: number;
  readonly groups?: readonly Group[];
  /** The list shows fewer hits than there are. */
  readonly cut?: boolean;
}

/** The fields each row reads. */
const FIELDS: NonNullable<InputOf<"element.list">["fields"]> = ["identifier", "title", "type", "status"];

/** A grouped list pages over its rows, which can be more than its elements; `elements` keeps their number. */
const byRows = <T extends { readonly total: number; readonly rows?: number }>(
  page: T,
): T & { readonly elements: number } => ({ ...page, total: page.rows ?? page.total, elements: page.total });

async function readList(base: Base, state: ListState): Promise<Rows> {
  const sort = state.sort === undefined ? {} : { sort: [state.sort] };
  const group = state.group === undefined ? {} : { group: state.group };
  const pages = await allPages(
    async (offset) =>
      byRows(
        await call("element.list", {
          selection: selectionOf(base, state),
          ...(base.perspective === undefined ? {} : { perspective: base.perspective }),
          ...sort,
          ...group,
          fields: FIELDS,
          limit: PAGE,
          offset,
        }),
      ),
    (page) => page.partial?.length ?? 0,
  );
  const first = pages[0];
  const depths = pages.flatMap((p) => p.tree ?? []).map((t) => t.depth);
  const rows = pages
    .flatMap((p) => p.partial ?? [])
    .map((e, at) => ({
      id: e.id,
      shortId: e.shortId,
      ...(e.identifier === undefined ? {} : { identifier: e.identifier }),
      title: e.title ?? "",
      type: e.type,
      status: e.status,
      ...(depths[at] === undefined ? {} : { depth: depths[at] }),
    }));
  return {
    rows,
    total: first?.elements ?? 0,
    ...(first?.groups === undefined ? {} : { groups: first.groups }),
  };
}

async function readSearch(base: Base, state: ListState, query: string): Promise<Rows> {
  const input = {
    query,
    selection: selectionOf(base, state),
    ...(state.group === undefined ? {} : { group: state.group }),
    limit: SEARCH_PAGE,
  };
  const first = await call("element.search", { ...input, offset: 0 });
  const rowsTotal = first.rows ?? first.total;
  const offsets: number[] = [];
  for (let offset = SEARCH_PAGE; offset < Math.min(rowsTotal, SEARCH_MOST); offset += SEARCH_PAGE) {
    offsets.push(offset);
  }
  const rest = await Promise.all(offsets.map((offset) => call("element.search", { ...input, offset })));
  const hits = [first, ...rest].flatMap((p) => p.hits);
  return {
    rows: hits.map((hit) => ({
      id: hit.id,
      shortId: hit.shortId,
      ...(hit.identifier === undefined ? {} : { identifier: hit.identifier }),
      title: hit.title,
      type: hit.type,
      status: hit.status,
      ...(hit.titleMarks === undefined ? {} : { titleMarks: hit.titleMarks }),
      ...(hit.snippet === undefined ? {} : { snippet: hit.snippet }),
    })),
    total: first.total,
    ...(first.groups === undefined ? {} : { groups: first.groups }),
    cut: rowsTotal > hits.length,
  };
}

// ---------- The facets ----------

interface Option {
  readonly value: FacetValue;
  readonly label: string;
  readonly count: number;
}

interface Facet {
  readonly key: FacetKey;
  readonly name: string;
  readonly options: readonly Option[];
}

const valueLabel = (v: {
  value: FacetValue;
  name?: string | undefined;
  title?: string | undefined;
  identifier?: string | undefined;
}): string =>
  // A package or another target by its title: its identifier is often only a short form of it.
  v.name ?? v.title ?? v.identifier ?? String(v.value);

/** The options of each facet: of a facet with picks, the counts without its own picks, so others can be added. */
function facetsOf(main: Facets, own: ReadonlyMap<FacetKey, Facets>, state: ListState): Facet[] {
  const of = (key: FacetKey): Facets => own.get(key) ?? main;
  const keep = (key: FacetKey, options: Option[]): Option[] => {
    // A picked value that no element has any more still shows, so it can be taken away.
    const missing = (state.picks.get(key) ?? []).filter((v) => !options.some((o) => o.value === v));
    return [
      ...options,
      ...missing.map((value) => ({ value, label: value === null ? "No value" : String(value), count: 0 })),
    ];
  };
  const out: Facet[] = [];
  const types = keep(
    "type",
    of("type").types.map((t) => ({
      value: t.key,
      label: typeDef(store.mm, t.key) === undefined ? t.name : typeName(store.mm, t.key),
      count: t.count,
    })),
  );
  out.push({ key: "type", name: "Type", options: types });
  const statuses = keep(
    "status",
    of("status").statuses.map((s) => ({ value: s.key, label: statusName(store.mm, s.key), count: s.count })),
  );
  out.push({ key: "status", name: "Status", options: statuses });
  const skip = new Set([propKey(store.mm, "title"), propKey(store.mm, "identifier")]);
  for (const p of main.properties) {
    if (skip.has(p.key) || p.values === undefined) {
      continue;
    }
    const key: FacetKey = `p.${p.key}`;
    const source = of(key).properties.find((x) => x.key === p.key) ?? p;
    const values = (source.values ?? []).map((v) => ({
      value: v.value,
      label: valueLabel(v),
      count: v.count,
    }));
    const none =
      source.missing > 0 && source.count > 0
        ? [{ value: null, label: "No value", count: source.missing }]
        : [];
    out.push({ key, name: sentence(p.name), options: keep(key, [...values, ...none]) });
  }
  // A facet with a single choice that no one picked narrows nothing.
  return out.filter((f) => f.options.length > 1 || state.picks.has(f.key));
}

async function readFacets(base: Base, state: ListState): Promise<Facet[]> {
  const search =
    base.kind === "search" && state.query !== undefined ? { search: { query: state.query } } : {};
  const read = (except?: FacetKey): Promise<Facets> =>
    call("element.facets", { selection: selectionOf(base, state, except), ...search });
  const picked = [...state.picks.keys()];
  const [main, ...own] = await Promise.all([read(), ...picked.map(async (key) => read(key))]);
  return facetsOf(main, new Map(picked.map((key, at) => [key, own[at] ?? main])), state);
}

// ---------- Drawing ----------

/** The key that opens the finder (palette.ts), in the words of the system. */
export const finderKey = (): string => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K");

/** Where the page goes with `state`, keeping its base; `focus` is the control that keeps the focus. */
let refocus: string | undefined;
function go(route: Route, state: ListState, focus?: string): void {
  refocus = focus;
  location.hash = `#/${route.parts.map(encodeURIComponent).join("/")}${queryOf(state)}`;
}

/** `text` with the matched words in `<mark>`, as text nodes. */
function marked(text: string, marks: Marks | undefined): Child[] {
  if (marks === undefined || marks.length === 0) {
    return [text];
  }
  const out: Child[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) {
      out.push(text.slice(at, m.start));
    }
    out.push(h("mark", null, text.slice(m.start, m.end)));
    at = m.end;
  }
  out.push(text.slice(at));
  return out;
}

function rowItem(row: Row, from: string, mixed: boolean): HTMLElement {
  const e = el(row.id);
  const shown = e ?? row;
  const a = h(
    "a",
    {
      href: `${hashOf("e", refOf(shown))}?from=${encodeURIComponent(from)}`,
      class: `it${row.depth === undefined ? "" : " tree"}`,
      "data-id": row.id,
    },
    h("span", { class: "id" }, shownId(shown)),
    h("span", { class: "t", "data-vt": refOf(shown) }, marked(row.title, row.titleMarks)),
    h("span", null),
    h(
      "span",
      { class: "m" },
      statusPill(row.status),
      verificationMark(verificationOf(row.id)?.status),
      mixed && row.type !== undefined ? h("span", { class: "ty" }, typeName(store.mm, row.type)) : null,
    ),
    row.snippet === undefined || row.snippet.text === ""
      ? null
      : h("span", { class: "snip" }, marked(row.snippet.text, row.snippet.marks)),
  );
  if (row.depth !== undefined && row.depth > 0) {
    a.style.setProperty("--depth", String(Math.min(row.depth, 12)));
  }
  return h("div", { role: "listitem" }, a);
}

const groupLabel = (g: Group): string =>
  g.value === undefined
    ? g.unavailable === undefined
      ? "No value"
      : "No value, or not available"
    : valueLabel({ ...g, value: g.value });

function rowsBlock(rows: Rows, from: string): Child {
  const mixed = new Set(rows.rows.map((r) => r.type)).size > 1;
  if (rows.groups === undefined) {
    return h(
      "div",
      { role: "list" },
      rows.rows.map((r) => rowItem(r, from, mixed)),
    );
  }
  return rows.groups.map((g) => {
    const part = rows.rows.slice(g.offset, g.offset + g.count);
    return part.length === 0
      ? null
      : [
          h("h2", { class: "group" }, groupLabel(g), h("b", null, g.count)),
          h(
            "div",
            { role: "list" },
            part.map((r) => rowItem(r, from, mixed)),
          ),
        ];
  });
}

const words = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

interface Choice {
  readonly value: string;
  readonly label: string;
}

const select = (
  label: string,
  name: string,
  choices: readonly Choice[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement => {
  const control = h(
    "select",
    { "data-ctl": name },
    choices.map((c) => h("option", { value: c.value, selected: c.value === value }, c.label)),
  );
  control.addEventListener("change", () => {
    onChange(control.value);
  });
  return h("label", { class: "ctl" }, h("span", null, label), control);
};

/** What a list can be sorted by: the keys of `element.list` and the properties that hold single values. */
function sortChoices(base: Base): Choice[] {
  const stored = base.storedSort?.[0];
  const head: Choice = {
    value: "",
    label: stored === undefined ? "Workspace order" : `As saved (${sortName(stored.by)})`,
  };
  const keys = [
    ...(propKey(store.mm, "identifier") === undefined ? [] : ["identifier"]),
    "title",
    "type",
    "status",
    "verification",
    "hierarchy",
    ...store.mm.properties
      .filter(
        (p) =>
          p.meaning === undefined &&
          p.many !== true &&
          (p.kind === "number" ||
            p.kind === "date" ||
            p.kind === "choice" ||
            (p.kind === "text" && p.markdown !== true)),
      )
      .map((p) => p.key),
  ];
  return [head, ...keys.map((key) => ({ value: key, label: sortName(key) }))];
}

const SORT_NAMES: Readonly<Record<string, string>> = {
  id: "Short ID",
  identifier: "ID",
  title: "Title",
  type: "Type",
  status: "Status",
  verification: "Verification",
  hierarchy: "Derivation tree",
};

const sortName = (by: string): string => SORT_NAMES[by] ?? sentence(propDef(store.mm, by)?.name ?? by);

/** What a list can be grouped by: type, status, package, and the properties whose values the facets offer. */
function groupChoices(base: Base, facets: Facets): Choice[] {
  const packages = propKey(store.mm, "packages");
  const head: Choice = {
    value: "",
    label: base.storedGroup === undefined ? "No groups" : `As saved (${groupName(base.storedGroup)})`,
  };
  return [
    head,
    { value: "type", label: "Type" },
    { value: "status", label: "Status" },
    ...(packages === undefined ? [] : [{ value: "package", label: packageWord(store.mm) }]),
    ...facets.properties
      .filter((p) => p.values !== undefined && p.key !== packages && p.key !== propKey(store.mm, "title"))
      .map((p) => ({ value: p.key, label: sentence(p.name) })),
  ];
}

const groupName = (key: string): string =>
  key === "type"
    ? "Type"
    : key === "status"
      ? "Status"
      : key === "package"
        ? packageWord(store.mm)
        : sentence(propDef(store.mm, key)?.name ?? key);

function toolbar(route: Route, base: Base, state: ListState, facets: Facets): HTMLElement {
  const sortBy = state.sort?.by ?? "";
  const searching = base.kind === "search";
  return h(
    "div",
    { class: "tools" },
    searching
      ? null
      : select("Sort", "sort", sortChoices(base), sortBy, (by) => {
          const next: ListState =
            by === ""
              ? { ...state, sort: undefined }
              : { ...state, sort: { by, order: state.sort?.order ?? "asc" } };
          go(route, next, '[data-ctl="sort"]');
        }),
    searching || sortBy === "" || sortBy === "hierarchy"
      ? null
      : select(
          "Order",
          "order",
          [
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ],
          state.sort?.order ?? "asc",
          (order) => {
            go(
              route,
              { ...state, sort: { by: sortBy, order: order === "desc" ? "desc" : "asc" } },
              '[data-ctl="order"]',
            );
          },
        ),
    select("Group", "group", groupChoices(base, facets), state.group ?? "", (group) => {
      go(route, group === "" ? { ...state, group: undefined } : { ...state, group }, '[data-ctl="group"]');
    }),
  );
}

function searchForm(route: Route, state: ListState): HTMLElement {
  const input = h("input", {
    type: "search",
    name: "q",
    value: state.query ?? "",
    placeholder: "Words, an ID or a phrase in quotes",
    "aria-label": "Search for",
    autocomplete: "off",
    "data-ctl": "q",
  });
  const form = h(
    "form",
    { class: "sform", role: "search" },
    input,
    h("button", { class: "btn", type: "submit" }, "Search"),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    go(route, query === "" ? { ...state, query: undefined } : { ...state, query }, '[data-ctl="q"]');
  });
  return h(
    "div",
    null,
    form,
    h("p", { class: "note" }, `${finderKey()} finds a list or an element from any page.`),
  );
}

function chips(route: Route, state: ListState, facets: readonly Facet[]): Child {
  if (state.picks.size === 0) {
    return null;
  }
  const items: HTMLElement[] = [];
  for (const [key, values] of state.picks) {
    const facet = facets.find((f) => f.key === key);
    for (const value of values) {
      const label = facet?.options.find((o) => o.value === value)?.label ?? String(value);
      const name = facet?.name ?? key;
      const b = h(
        "button",
        { class: "chip", type: "button", "aria-label": `Remove ${name}: ${label}` },
        h("span", null, `${name}: `, h("b", null, label)),
        h("span", { "aria-hidden": "true" }, "×"),
      );
      b.addEventListener("click", () => {
        go(route, toggle(state, key, value), ".chips .chip, [data-ctl]");
      });
      items.push(b);
    }
  }
  const clear = h("button", { class: "btn sm", type: "button" }, "Clear all");
  clear.addEventListener("click", () => {
    go(route, withoutPicks(state), "[data-ctl]");
  });
  return h("div", { class: "chips", role: "group", "aria-label": "Narrowed by" }, items, clear);
}

function facetPanel(route: Route, state: ListState, facets: readonly Facet[]): HTMLElement {
  return h(
    "aside",
    { class: "fc", "aria-labelledby": "fc-h" },
    h("h2", { id: "fc-h" }, "Narrow the list"),
    facets.length === 0 ? h("p", { class: "note" }, "Nothing to narrow it by.") : null,
    facets.map((facet, at) => {
      const id = `fc-${String(at)}`;
      const option = (o: Option): HTMLElement => {
        const box = h("input", {
          type: "checkbox",
          checked: isPicked(state, facet.key, o.value),
          "data-facet": facet.key,
          "data-value": JSON.stringify(o.value),
        });
        box.addEventListener("change", () => {
          go(
            route,
            toggle(state, facet.key, o.value),
            `[data-facet="${CSS.escape(facet.key)}"][data-value="${CSS.escape(JSON.stringify(o.value))}"]`,
          );
        });
        return h(
          "label",
          { class: `fo${o.value === null ? " none" : ""}` },
          box,
          h("span", { class: "fl" }, o.label),
          h("b", { class: "num" }, o.count),
        );
      };
      const picked = facet.options.filter((o) => isPicked(state, facet.key, o.value));
      // The head of the options, and every picked one, stay visible; the rest is behind "more".
      const head = facet.options.filter((o, i) => i < FACET_HEAD || picked.includes(o));
      const rest = facet.options.filter((o) => !head.includes(o));
      return h(
        "fieldset",
        { class: "ff" },
        h("legend", { id }, facet.name),
        head.map(option),
        rest.length === 0
          ? null
          : h("details", null, h("summary", null, `${String(rest.length)} more`), rest.map(option)),
      );
    }),
  );
}

// ---------- Saving, renaming, deleting ----------

interface Field {
  readonly name: string;
  readonly label: string;
  readonly value?: string;
  readonly long?: boolean;
  readonly required?: boolean;
  /** A note under the field for what was typed, such as "replaces". */
  readonly hint?: (value: string) => string;
}

/** A dialog with a form; `submit` runs the command, and its refusal shows in the dialog. */
function formDialog(
  title: string,
  intro: Child,
  fields: readonly Field[],
  action: string,
  submit: (values: Readonly<Record<string, string>>) => Promise<void>,
): void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const error = h("div", { class: "derr" });
  const inputs = fields.map((f) => {
    const control =
      f.long === true
        ? h("textarea", { name: f.name, rows: 3 })
        : h("input", { name: f.name, autocomplete: "off" });
    control.value = f.value ?? "";
    control.required = f.required === true;
    const hint = h("p", { class: "dhint", "aria-live": "polite" });
    const update = (): void => {
      hint.textContent = f.hint?.(control.value) ?? "";
    };
    control.addEventListener("input", update);
    update();
    return { f, control, row: h("label", { class: "dfield" }, h("span", null, f.label), control, hint) };
  });
  const button = h("button", { class: "btn primary", type: "submit" }, action);
  const cancel = h("button", { class: "btn", type: "button" }, "Cancel");
  const form = h(
    "form",
    null,
    h("h2", null, title),
    intro,
    inputs.map((i) => i.row),
    error,
    h("div", { class: "dactions" }, cancel, button),
  );
  const dialog = h("dialog", { class: "dlg", "aria-label": title }, form);
  cancel.addEventListener("click", () => {
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    opener?.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(inputs.map((i) => [i.f.name, i.control.value]));
    button.disabled = true;
    error.replaceChildren();
    submit(values).then(
      () => {
        dialog.close();
      },
      (problem: unknown) => {
        button.disabled = false;
        error.replaceChildren(errorBox(problem));
      },
    );
  });
  document.body.append(dialog);
  dialog.showModal();
}

/** The sort and grouping a saved list keeps: what the page shows, else what the base stored. */
const keptSort = (base: Base, state: ListState): { sort?: SortKey[] } =>
  state.sort !== undefined
    ? { sort: [state.sort] }
    : base.storedSort === undefined
      ? {}
      : { sort: base.storedSort.map((k) => ({ by: k.by, order: k.order ?? "asc" })) };

async function saveFilter(base: Base, state: ListState, name: string, description: string): Promise<void> {
  await call("filter.save", {
    name,
    ...(description.trim() === "" ? {} : { description: description.trim() }),
    where: allOf([...base.where, ...pickConditions(state)]),
    ...(base.view === undefined ? {} : { view: base.view }),
    ...keptSort(base, state),
  });
}

async function savePerspective(
  base: Base,
  state: ListState,
  name: string,
  description: string,
): Promise<void> {
  const group = state.group ?? base.storedGroup;
  await call("perspective.save", {
    name,
    description: description.trim(),
    ...(base.perspectiveFilter === undefined ? {} : { filter: base.perspectiveFilter }),
    where: allOf([...base.perspectiveWhere, ...pickConditions(state)]),
    ...(group === undefined ? {} : { group }),
    ...keptSort(base, state),
  });
}

const done = (text: string, href: string): void => {
  forgetSaved();
  announce(text);
  location.hash = href;
};

function saveAs(kind: "filter" | "perspective", base: Base, state: ListState, data: Saved): void {
  const word = kind === "filter" ? "saved filter" : "perspective";
  const names = kind === "filter" ? data.filters.map((f) => f.name) : data.perspectives.map((p) => p.name);
  const intro =
    kind === "filter"
      ? h(
          "p",
          null,
          "A saved filter keeps which elements the list shows, and its sort. Lists, exports and every command can use it by its name.",
        )
      : h("p", null, "A perspective keeps which elements the list shows, its sort and its grouping.");
  formDialog(
    kind === "filter" ? "Save as filter" : "Save as perspective",
    intro,
    [
      {
        name: "name",
        label: "Name",
        required: true,
        hint: (value) =>
          names.some((n) => sameName(n, value.trim()))
            ? `A ${word} with this name exists. Saving replaces it.`
            : "",
      },
      { name: "description", label: "What it is for (optional)", long: true },
    ],
    "Save",
    async ({ name = "", description = "" }) => {
      const clean = name.trim();
      await (kind === "filter"
        ? saveFilter(base, state, clean, description)
        : savePerspective(base, state, clean, description));
      done(`The ${word} ${clean} is saved.`, hashOf("l", kind, clean));
    },
  );
}

/** Saves the picks, sort and grouping into the saved filter or perspective the page shows. */
async function saveChanges(route: Route, base: Base, data: Saved): Promise<void> {
  const state = parseState(route.params);
  if (base.kind === "filter") {
    const f = filterNamed(data, base.arg);
    await saveFilter(base, state, base.title, f?.description ?? "");
  } else {
    const p = perspectiveNamed(data, base.arg);
    await savePerspective(base, state, base.title, p?.description ?? "");
  }
  done(`The changes are saved in ${base.title}.`, hashOf("l", base.kind, base.title));
}

function rename(route: Route, base: Base): void {
  const kind = base.kind === "filter" ? "filter" : "perspective";
  const word = kind === "filter" ? "saved filter" : "perspective";
  formDialog(
    `Rename the ${word}`,
    h("p", null, `${cap(word)} “${base.title}”. Its file is renamed to match.`),
    [{ name: "name", label: "New name", value: base.title, required: true }],
    "Rename",
    async ({ name = "" }) => {
      const clean = name.trim();
      let changed = 0;
      if (kind === "filter") {
        changed = (await call("filter.rename", { name: base.title, newName: clean })).perspectives.length;
      } else {
        await call("perspective.rename", { name: base.title, newName: clean });
      }
      done(
        `Renamed to ${clean}.${changed > 0 ? ` ${words(changed, "perspective", "perspectives")} now use the new name.` : ""}`,
        `${hashOf("l", kind, clean)}${queryOf(parseState(route.params))}`,
      );
    },
  );
}

async function remove(base: Base): Promise<void> {
  const kind = base.kind === "filter" ? "filter" : "perspective";
  const word = kind === "filter" ? "saved filter" : "perspective";
  // The first call deletes nothing: it names the file, so the person confirms what goes.
  const ask =
    kind === "filter"
      ? await call("filter.delete", { name: base.title })
      : await call("perspective.delete", { name: base.title });
  formDialog(
    `Delete the ${word}?`,
    h(
      "p",
      null,
      `${cap(word)} “${ask.name}” is deleted with its file `,
      h("code", null, ask.file),
      ". The elements it lists stay as they are.",
    ),
    [],
    "Delete",
    async () => {
      const input = { name: ask.name, confirm: true, file: ask.file, expectedFileSha256: ask.fileSha256 };
      await (kind === "filter" ? call("filter.delete", input) : call("perspective.delete", input));
      done(`The ${word} ${ask.name} is deleted.`, hashOf("l", "all"));
    },
  );
}

function actions(route: Route, base: Base, state: ListState, data: Saved): HTMLElement {
  const button = (label: string, act: string, run: () => void | Promise<void>): HTMLElement => {
    const b = h("button", { class: "btn sm", type: "button", "data-act": act }, label);
    b.addEventListener("click", () => {
      void (async () => {
        try {
          await run();
        } catch (error) {
          formDialog("This did not work", errorBox(error), [], "Close", () => Promise.resolve());
        }
      })();
    });
    return b;
  };
  const own = base.kind === "filter" || base.kind === "perspective";
  const empty = base.kind === "search" && state.query === undefined;
  return h(
    "div",
    { class: "acts" },
    own && changesList(state) ? button("Save changes", "save", () => saveChanges(route, base, data)) : null,
    empty
      ? null
      : button("Save as filter", "save-filter", () => {
          saveAs("filter", base, state, data);
        }),
    empty
      ? null
      : button("Save as perspective", "save-perspective", () => {
          saveAs("perspective", base, state, data);
        }),
    own
      ? button("Rename", "rename", () => {
          rename(route, base);
        })
      : null,
    own ? button("Delete", "delete", () => remove(base)) : null,
  );
}

// ---------- The page ----------

const railKey = (route: Route): string => `l:${route.parts.slice(1).join("/")}`;

function emptyText(base: Base, state: ListState): string {
  if (base.kind === "search" && state.query === undefined) {
    return "Type what you look for: words, an ID, or a phrase in quotes.";
  }
  if (state.picks.size > 0) {
    return "No element matches these choices. Take one away to see more.";
  }
  return base.kind === "search" ? "Nothing found. Try other or fewer words." : "This list has no elements.";
}

/** A list page that has no list: a type, package, filter or perspective that does not exist. */
const noList = (route: Route, why: string): HTMLElement =>
  frame(
    railKey(route),
    h(
      "section",
      { class: "list lv-msg", "aria-labelledby": "list-h" },
      h("div", { class: "lh" }, h("h1", { id: "list-h" }, titleOfList(route) ?? "List")),
      h(
        "div",
        { class: "empty" },
        h("strong", null, why),
        h("a", { href: hashOf("l", "all") }, "Show all elements"),
      ),
    ),
    { wide: true },
  );

interface Read {
  readonly rows: Rows;
  readonly facets: Facet[];
  readonly problem?: unknown;
}

/** The rows and facets of the list; a refusal of ReqSeq shows above an empty list. */
async function readPage(base: Base, state: ListState): Promise<Read> {
  const asked = base.kind !== "search" || state.query !== undefined;
  try {
    const [rows, facets] = await Promise.all([
      !asked
        ? Promise.resolve({ rows: [], total: 0 })
        : base.kind === "search" && state.query !== undefined
          ? readSearch(base, state, state.query)
          : readList(base, state),
      asked ? readFacets(base, state) : Promise.resolve([]),
    ]);
    return { rows, facets };
  } catch (problem) {
    return { rows: { rows: [], total: 0 }, facets: [], problem };
  }
}

function countText(base: Base, state: ListState, rows: Rows): string {
  // In a workspace with variants a list holds what applies in the chosen view.
  const where = hasVariants() ? ` in ${variantName(store.view)}` : "";
  if (base.kind !== "search") {
    return `${words(rows.total, "element", "elements")}${where}`;
  }
  if (state.query === undefined) {
    return "";
  }
  const cut =
    rows.cut === true ? `, the best ${String(rows.rows.length)} shown. More words narrow the search.` : "";
  return `${words(rows.total, "hit", "hits")}${where}${cut}`;
}

function listSection(route: Route, base: Base, state: ListState, data: Saved, read: Read): HTMLElement {
  const { rows, facets, problem } = read;
  const noId = rows.rows.length > 0 && rows.rows.every((r) => shownId(el(r.id) ?? r) === "");
  return h(
    "section",
    { class: `list${noId ? " noid" : ""}`, "aria-labelledby": "list-h" },
    h(
      "div",
      { class: "lh" },
      h("h1", { id: "list-h" }, base.title),
      base.note === undefined || base.note === "" ? null : h("p", null, base.note),
      base.kind === "search" ? searchForm(route, state) : null,
      h("p", { class: "count", "data-count": rows.total }, countText(base, state, rows)),
      toolbar(route, base, state, data.facets),
      chips(route, state, facets),
      actions(route, base, state, data),
    ),
    h(
      "div",
      { class: "lscroll" },
      problem === undefined ? null : h("div", { class: "lerr" }, errorBox(problem)),
      rows.rows.length === 0 && problem === undefined
        ? h("div", { class: "empty" }, h("strong", null, emptyText(base, state)))
        : rowsBlock(rows, route.hash),
    ),
  );
}

/** After the router moved the focus to the heading: back to the control the person used. */
function restoreFocus(root: HTMLElement): void {
  if (refocus === undefined) {
    return;
  }
  const selector = refocus;
  refocus = undefined;
  requestAnimationFrame(() => {
    (root.querySelector<HTMLElement>(selector) ?? root.querySelector<HTMLElement>("[data-ctl]"))?.focus();
  });
}

async function render(root: HTMLElement, route: Route): Promise<void> {
  if (!isKind(route.parts[1])) {
    location.replace(`#${hashOf("l", "all")}`);
    return;
  }
  await prepareRail();
  const data = await savedData();
  const state = parseState(route.params);
  const base = baseOf(route, data, state);
  if (typeof base === "string") {
    if (isCurrent(route)) {
      await swap(root, noList(route, base));
      document.title = `${titleOfList(route) ?? "List"} · ReqSeq`;
    }
    return;
  }
  const read = await readPage(base, state);
  // A page that finishes after the person moved on must not draw over the new one.
  if (!isCurrent(route)) {
    return;
  }
  await swap(
    root,
    frame(
      railKey(route),
      h(
        "div",
        { class: "lv" },
        listSection(route, base, state, data, read),
        facetPanel(route, state, read.facets),
      ),
      { wide: true },
    ),
  );
  document.title = `${base.title} · ReqSeq`;
  restoreFocus(root);
}

addRoute("l", render);
addTitle("l", titleOfList);

// ---------- The rail ----------

addRailSection({
  order: 20,
  title: "Browse",
  prepare: async () => {
    await savedData();
  },
  links: () => {
    const facets = saved?.facets;
    return [
      { href: hashOf("l", "search"), key: "l:search", name: "Search" },
      { href: hashOf("l", "all"), key: "l:all", name: "All elements", count: facets?.total },
      ...(facets?.types ?? []).map((t) => ({
        href: hashOf("l", "type", t.key),
        key: `l:type/${t.key}`,
        name: typeDef(store.mm, t.key) === undefined ? t.name : typePlural(store.mm, t.key),
        count: t.count,
      })),
    ];
  },
});

addRailSection({
  order: 22,
  // A getter: the rail reads it when it is drawn, in the words of the workspace's metamodel.
  get title() {
    const type = typesWith(store.mm, "package")[0];
    return type === undefined ? "Packages" : typePlural(store.mm, type);
  },
  links: () => {
    const facet = saved === undefined ? undefined : packagesFacet(saved.facets);
    return (facet?.values ?? []).map((v) => ({
      href: hashOf("l", "package", String(v.value)),
      key: `l:package/${String(v.value)}`,
      name: v.title ?? String(v.value),
      count: v.count,
    }));
  },
});

addRailSection({
  order: 30,
  title: "Saved filters",
  links: () =>
    (saved?.filters ?? []).map((f) => ({
      href: hashOf("l", "filter", f.name),
      key: `l:filter/${f.name}`,
      name: f.name,
    })),
});

addRailSection({
  order: 32,
  title: "Perspectives",
  links: () =>
    (saved?.perspectives ?? []).map((p) => ({
      href: hashOf("l", "perspective", p.name),
      key: `l:perspective/${p.name}`,
      name: p.name,
    })),
});
