// The lists of the HTML export (SR-233 AK1, AK5): one page `lists/<type key>.html` per type with at least one element
// that has a page (no invalid status, D-044), except the types with the meaning package or variant, in the order of
// the type lines of the start page (`overviewDisplay`: the metamodel's types, then an unknown type as its first element
// appears, `inTypeOrder`). The page is the whole list as a table, so it stands
// there without script (AK5); `assets/list.js` (`list-script.ts`) adds the search field, the filters, the sorting and
// the grouping on top of it.
//
// The columns, filters, cells, search texts, facets and ranks are the display model of the list (`listDisplay`,
// ADR-0019 point 7, `displays.md`), built from the entries as `element.list` gives them (`listRowOf`: the
// verification in the core, the open hints of `hint.list`); this module writes it as HTML:
//
// - Rows, in the order of their identifier (`sortElements` by `identifier`, as `element.list` sorts): the identifier
//   (else the short ID) as a link to the page, the verification status in the core as a badge in the short form of
//   `verificationLabel` ("–" for a requirement that is not in the core's view, SR-137 AK4), the open hints as a badge,
//   an empty cell for none. The table stands in a container of its own that scrolls, so a narrow screen scrolls the
//   table and not the page (#2138); on wide screens it fits beside the column "On this page" (#2181).
// - `data-q` holds the search text, `data-f` the facets and `data-s` the ranks of the model; `data-rq-list` its
//   columns and filters. The order of SR-075 AK1 that ranks them is `listOrderOf` (`sortValueOf`: the metamodel's
//   order for statuses and choices, then numbers, then text ignoring case); the verification status is in the
//   order of SR-075 AK5 (`VERIFICATION_RANKS`: failed, open, outdated, verified, indirect as verified).
// - Change since a baseline (SR-233 AK2), when the workspace has one: the baselines newest first in `data-rq-list`
//   (`compare`), each row's change since each of them as an index into `CHANGE_VALUES` (`data-b`, as `baseline.get`
//   names it, SR-232 AK7; "not in the baseline" when the baseline neither lists it nor adds it), and a last column
//   "Change since baseline" written `hidden` and empty: no baseline is chosen at first, so there is no comparison.
import type { ListCell, ListMetamodel, ListOrder, ListRowDisplay, ListRowInput } from "../displays/index.js";
import { listDisplay } from "../displays/index.js";
import type { DataExportElement, VerificationStatus } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { SortValue } from "../query/index.js";
import {
  NO_RANKS,
  VERIFICATION_RANKS,
  compareSortValues,
  ranksOf,
  sortElements,
  sortValueOf,
} from "../query/index.js";
import { zip } from "../files/index.js";
import { inTypeOrder } from "../type-order.js";
import { elementPage } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The address of the list of the type `type`, relative to the export folder. */
export const listPage = (type: string): string => `lists/${type}.html`;

/** The script of the lists, relative to the export folder. */
export const LIST_SCRIPT = "assets/list.js";

/** What a list shows of one element. */
export interface ListEntry {
  readonly record: ElementRecord;
  readonly element: DataExportElement;
  /** The number of its open hints. */
  readonly hints: number;
}

/** The values of the change since a baseline, in this order (SR-232 AK7, SR-051 AK2, AK3). */
export const CHANGE_VALUES = ["changed", "added", "removed", "unchanged", "not in the baseline"] as const;

/** The label of the column and filter of the change since a baseline. */
export const CHANGE_LABEL = "Change since baseline";

/** The baselines a list compares with (SR-233 AK2). */
export interface ListCompare {
  /** Each baseline as the choice names it, newest first. */
  readonly baselines: readonly string[];
  /** The index in `CHANGE_VALUES` of the change of `record` since each baseline, in the order of `baselines`. */
  readonly changeOf: (record: ElementRecord) => readonly number[];
}

/** What the lists are built from. */
export interface ListContext {
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** One list page: its type, its title and its content. */
export interface ListPage {
  readonly type: string;
  readonly path: string;
  readonly title: string;
  readonly count: number;
  readonly body: string;
}

/** The verification status in the core of a requirement, none outside the core's view (SR-233 AK1, AK4, as SR-137 AK4). */
export const coreVerification = (element: DataExportElement): string | undefined =>
  element.verification?.find((entry) => entry.view === "core")?.status;

/** The colour of the badge of each verification status, as the docs' badges name them. */
const BADGES: Readonly<Record<VerificationStatus, string>> = {
  verified: "success",
  indirect: "note",
  open: "caution",
  outdated: "danger",
  failed: "danger",
};

/** A badge of the colour `variant` (`BADGES`). */
const badge = (label: string, variant: string): string =>
  `<span class="rq-badge rq-badge-${variant}">${escapeHtml(label)}</span>`;

/** The JSON of `value` for an attribute. */
const attribute = (value: unknown): string => escapeHtml(JSON.stringify(value));

/** The row of `listDisplay` for an entry: the element as `element.list` gives it, its core verification and hints. */
export const listRowOf = ({ element, hints }: ListEntry): ListRowInput => ({
  element,
  verification: element.verification?.filter((entry) => entry.view === "core"),
  hints,
});

/** What `listDisplay` reads of the metamodel. */
export const listMetamodelOf = (metamodel: Metamodel): ListMetamodel => ({
  types: metamodel.effectiveTypes,
  properties: metamodel.properties,
  statuses: metamodel.statuses,
});

/** The order of SR-075 AK1 for the values of a list (`sortValueOf`: the metamodel's order of statuses and choices), AK5 for the verification status. */
export const listOrderOf = (metamodel: Metamodel): ListOrder<SortValue> => {
  const statuses = ranksOf(metamodel.statuses);
  return {
    keyOf: (field, value) => {
      switch (field.kind) {
        case "status":
          return sortValueOf(value, statuses);
        case "choice":
          return sortValueOf(value, ranksOf(field.choices));
        case "hints":
          return sortValueOf(Number(value), NO_RANKS);
        case "verification":
          return sortValueOf(value, VERIFICATION_RANKS);
        case "packages":
        case "title":
          return sortValueOf(value, NO_RANKS);
      }
    },
    compare: compareSortValues,
  };
};

/** A cell of the list as HTML. */
const cellHtml = (row: ListRowDisplay, cell: ListCell): string => {
  switch (cell.kind) {
    case "id":
      return `<a href="../${elementPage(row.ref.id)}">${escapeHtml(cell.text)}</a>`;
    case "verification":
      return cell.cell === undefined ? escapeHtml(cell.text) : badge(cell.text, BADGES[cell.cell.status]);
    case "hints":
      return cell.count === 0 ? "" : badge(String(cell.count), "caution");
    case "text":
      return escapeHtml(cell.text);
  }
};

/** The index of the title column, whose cells get the class `rq-title` (`LIST_CSS`). */
const TITLE_COLUMN = 1;

const classOf = (column: number): string => (column === TITLE_COLUMN ? ' class="rq-title"' : "");

/** `entries` in the order of their identifier (see the file comment). */
export const sortedByIdentifier = (context: ListContext, entries: readonly ListEntry[]): ListEntry[] => {
  const { metamodel, store, shortIds } = context;
  const position = new Map<ElementRecord, number>();
  sortElements(
    { command: "html.export", metamodel, store, shortIds },
    entries.map((e) => e.record),
    [{ by: "identifier", order: "asc" }],
  ).elements.forEach((record, at) => position.set(record, at));
  return [...entries].sort((a, b) => Number(position.get(a.record)) - Number(position.get(b.record)));
};

/** The identifier of an element as rows show it: its identifier, else its short ID. */
export const identifierOf = (element: DataExportElement): string => element.identifier ?? element.shortId;

/**
 * The list of `sorted`, all of type `type` with a page each, in the order of their identifier: the display model of
 * `listDisplay` as HTML, with the change since a baseline, which only the export shows (see the file comment).
 */
export const listPageOf = (
  context: ListContext,
  type: string,
  sorted: readonly ListEntry[],
  compare?: ListCompare,
): ListPage => {
  const comparing = compare !== undefined && compare.baselines.length > 0 ? compare : undefined;
  const display = listDisplay(
    { type, rows: sorted.map(listRowOf), metamodel: listMetamodelOf(context.metamodel) },
    { id: "identifier", order: listOrderOf(context.metamodel) },
  );
  const settings = {
    columns: [...display.columns, ...(comparing === undefined ? [] : [{ label: CHANGE_LABEL }])],
    filters: display.filters,
    ...(comparing === undefined
      ? {}
      : { compare: { label: CHANGE_LABEL, baselines: comparing.baselines, values: CHANGE_VALUES } }),
  };
  const rows = zip(display.rows, sorted).map(([row, { record }]) => {
    const ranks = [...row.ranks, ...(comparing === undefined ? [] : [null])];
    const cells = [
      ...row.cells.map((cell, column) => `<td${classOf(column)}>${cellHtml(row, cell)}</td>`),
      ...(comparing === undefined ? [] : ["<td hidden></td>"]),
    ].join("");
    const change = comparing === undefined ? "" : ` data-b="${attribute(comparing.changeOf(record))}"`;
    return `<tr data-q="${escapeHtml(row.search)}" data-f="${attribute(row.facets)}" data-s="${attribute(ranks)}"${change}>${cells}</tr>`;
  });
  const head = [
    ...display.columns.map((column, at) => `<th scope="col"${classOf(at)}>${escapeHtml(column.label)}</th>`),
    ...(comparing === undefined ? [] : [`<th scope="col" hidden>${CHANGE_LABEL}</th>`]),
  ].join("");
  const body = [
    `<div class="rq-list" data-rq-list="${attribute(settings)}">`,
    `<p class="rq-list-count">${escapeHtml(counted(sorted.length))}</p>`,
    `<div class="rq-list-table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
    "</div>",
  ].join("");
  return { type, path: listPage(type), title: display.title, count: sorted.length, body };
};

/** `n elements`. */
const counted = (n: number): string => `${String(n)} ${n === 1 ? "element" : "elements"}`;

/**
 * The types that get a list (see the file comment), each with its elements of `entries`, in the order of `types`: the
 * type lines of the start page (`overviewDisplay`), so the lists and the start page share one order of types.
 */
export const listsOf = (
  context: Pick<ListContext, "metamodel">,
  entries: readonly ListEntry[],
  types: readonly { readonly key: string }[],
): { readonly type: string; readonly entries: readonly ListEntry[] }[] => {
  const { metamodel } = context;
  const byType = new Map<string, ListEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.record.type) ?? [];
    list.push(entry);
    byType.set(entry.record.type, list);
  }
  const lists = [...byType]
    .filter(([type]) => {
      const meaning = findType(metamodel, type)?.meaning;
      return meaning !== "package" && meaning !== "variant";
    })
    .map(([type, listed]) => ({ type, entries: listed }));
  return inTypeOrder(lists, (list) => list.type, types);
};

/** The styles of the lists: the table in its own scrolling container with a sticky head, the badges, the search bar, the chips with their menus and the line of the chosen filters. */
export const LIST_CSS = [
  ".rq-list { position: relative; }",
  ".rq-list-count { color: var(--sl-color-gray-3); font-size: var(--sl-text-sm); }",
  ".rq-list .rq-list-table { max-height: calc(100vh - var(--sl-nav-height) - 6rem); overflow: auto; border: 1px solid var(--sl-color-gray-5); border-radius: 0.5rem; }",
  ".rq-list .rq-list-table table { display: table; width: 100%; margin: 0; border-collapse: separate; border-spacing: 0; }",
  ".rq-list .rq-list-table :is(th, td) { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--sl-color-gray-5); vertical-align: baseline; text-align: start; }",
  ".rq-list .rq-list-table tbody tr:last-child > * { border-bottom: 0; }",
  ".rq-list .rq-list-table thead th { position: sticky; top: 0; z-index: 2; background: var(--sl-color-bg); border-bottom: 0; box-shadow: inset 0 -1px 0 var(--sl-color-gray-5); white-space: nowrap; }",
  ".rq-list .rq-list-table td:first-child { white-space: nowrap; }",
  ".rq-list th button { all: unset; cursor: pointer; display: inline-flex; gap: 0.3rem; align-items: baseline; font-weight: 600; }",
  ".rq-list th button:focus-visible { outline: 2px solid var(--sl-color-text-accent); outline-offset: 2px; }",
  ".rq-list th button::after { content: '↕'; content: '↕' / ''; color: var(--sl-color-gray-4); font-weight: 400; }",
  ".rq-list th[aria-sort=ascending] button::after { content: '↑'; content: '↑' / ''; color: var(--sl-color-text-accent); }",
  ".rq-list th[aria-sort=descending] button::after { content: '↓'; content: '↓' / ''; color: var(--sl-color-text-accent); }",
  ".rq-list .rq-list-table tr.rq-group th { position: static; background: var(--sl-color-gray-6); color: var(--sl-color-white); font-weight: 600; }",
  ".rq-list .rq-badge { display: inline-block; white-space: nowrap; line-height: 1; padding: 0.125rem 0.375rem; border: 1px solid var(--rq-badge-border); border-radius: 0.25rem; background: var(--rq-badge-bg); color: var(--rq-badge-text); font-family: var(--sl-font-system-mono); font-size: var(--sl-text-xs); }",
  ...["success", "note", "caution", "danger"].map(
    (v) =>
      `.rq-list .rq-badge-${v} { --rq-badge-bg: var(--sl-badge-${v}-bg); --rq-badge-border: var(--sl-badge-${v}-border); --rq-badge-text: var(--sl-badge-${v}-text); }`,
  ),
  ".rq-qbar { display: flex; align-items: center; gap: 0.6rem; margin-top: 1rem; padding: 0.45rem 0.85rem; border: 1px solid var(--sl-color-gray-5); border-radius: 0.6rem; background: var(--sl-color-black); color: var(--sl-color-gray-3); }",
  ".rq-qbar:focus-within { border-color: var(--sl-color-text-accent); box-shadow: 0 0 0 3px var(--sl-color-accent-low); }",
  ".rq-qbar svg { flex: none; }",
  ".rq-qbar input[type=search] { flex: 1; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--sl-color-white); font: inherit; outline: none; }",
  ".rq-qbar .rq-list-count { margin: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }",
  ".rq-qbar .rq-clear { all: unset; cursor: pointer; font-size: var(--sl-text-sm); color: var(--sl-color-text-accent); }",
  ".rq-qbar .rq-clear[hidden] { display: none; }",
  ".rq-qbar .rq-clear:focus-visible { outline: 2px solid var(--sl-color-text-accent); outline-offset: 2px; }",
  ".rq-pills { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.65rem; }",
  ".rq-pg { display: flex; flex-wrap: wrap; gap: 0.4rem; }",
  ".rq-pg-r { margin-inline-start: auto; }",
  ".rq-chip { position: relative; }",
  ".rq-chip[hidden] { display: none; }",
  ".rq-chip > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap; border: 1px dashed var(--sl-color-gray-4); border-radius: 999px; padding: 0.2rem 0.7rem; font-size: var(--sl-text-sm); color: var(--sl-color-gray-2); }",
  ".rq-chip > summary::-webkit-details-marker { display: none; }",
  ".rq-chip > summary:hover { background: var(--sl-color-gray-6); color: var(--sl-color-white); }",
  ".rq-chip > summary:focus-visible { outline: 2px solid var(--sl-color-text-accent); outline-offset: 2px; }",
  ".rq-chip-alt > summary { border-style: solid; border-color: var(--sl-color-gray-5); }",
  ".rq-chip > summary .rq-n { min-width: 1.25rem; height: 1.25rem; line-height: 1.25rem; text-align: center; border-radius: 999px; font-size: 0.72rem; font-weight: 700; font-variant-numeric: tabular-nums; background: var(--sl-color-text-accent); color: var(--sl-color-black); }",
  ".rq-chip.rq-on > summary { border-style: solid; border-color: var(--sl-color-text-accent); background: var(--sl-color-accent-low); color: var(--sl-color-white); }",
  ".rq-chip-values { position: absolute; z-index: 10; min-width: 14rem; max-width: min(22rem, calc(100vw - 2rem)); max-height: 20rem; overflow-y: auto; margin-top: 0.3rem; padding: 0.3rem; background: var(--sl-color-bg-nav); border: 1px solid var(--sl-color-gray-5); border-radius: 0.6rem; box-shadow: var(--sl-shadow-md); }",
  ".rq-pg-r .rq-chip-values { inset-inline-end: 0; }",
  ".rq-chip-values label { display: flex; gap: 0.5rem; align-items: center; padding: 0.3rem 0.5rem; border-radius: 0.35rem; cursor: pointer; font-size: var(--sl-text-sm); color: var(--sl-color-gray-2); }",
  ".rq-chip-values label:hover { background: var(--sl-color-gray-6); color: var(--sl-color-white); }",
  ".rq-chip-values input { accent-color: var(--sl-color-text-accent); margin: 0; }",
  ".rq-chip-values .rq-n { margin-inline-start: auto; color: var(--sl-color-gray-3); font-variant-numeric: tabular-nums; }",
  ".rq-tokens { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; min-height: 1.9rem; margin: 0.5rem 0; font-size: var(--sl-text-xs); }",
  ".rq-tokens button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.12rem 0.4rem 0.12rem 0.6rem; border-radius: 0.35rem; background: var(--sl-color-accent-low); color: var(--sl-color-white); }",
  ".rq-tokens button:focus-visible { outline: 2px solid var(--sl-color-text-accent); }",
  ".rq-tokens .rq-hint { color: var(--sl-color-gray-3); }",
  // On wide screens, beside the column "On this page", the table fits its container: column heads and badges wrap
  // between words, a long word of a title breaks, the other columns take what their values need and the title the
  // rest (#2181).
  "@media (min-width: 72rem) { .rq-list .rq-list-table :is(th, td) { padding-inline: 0.4rem; } .rq-list .rq-list-table thead th, .rq-list .rq-badge { white-space: normal; } .rq-list .rq-list-table .rq-title { width: 100%; overflow-wrap: anywhere; } }",
  "@media print { .rq-list .rq-list-table { max-height: none; overflow: visible; } }",
];
