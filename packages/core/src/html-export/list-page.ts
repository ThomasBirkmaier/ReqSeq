// The lists of the HTML export (SR-233 AK1, AK5): one page `lists/<type key>.html` per type with at least one element
// that has a page (no invalid status, D-044), except the types with the meaning package or variant, in the order of
// the metamodel's types (an unknown type after them by its key). The page is the whole list as a table, so it stands
// there without script (AK5); `assets/list.js` (`list-script.ts`) adds the search field, the filters, the sorting and
// the grouping on top of it.
//
// - Rows, in the order of their identifier (`sortElements` by `identifier`, as `element.list` sorts): identifier
//   (else the short ID) as a link to the page, title, status ("–" without one), packages, for a requirement type the
//   verification status in the core as a badge with the number of verified criteria of all ("not in the core" when
//   the core does not hold it), and the number of open hints of the element (`hint.list`) as a badge, an empty cell
//   for none. The table stands in a container of its own that scrolls, so a narrow screen scrolls the table and not
//   the page (#2138).
// - Search: each row carries its identifier, short ID and title folded (NFC, lower case) in `data-q`.
// - Filters (`data-f`): status, packages, the verification status in the core and each property of kind `choice` the
//   type has, in this order. Each filter lists its values in the order of SR-075 AK1 (`sortValueOf`: the metamodel's
//   order for statuses and choices, then numbers, then text ignoring case), "–" for an element without one last; a
//   row names the index of each of its values, so a row with several packages stands in each of them.
// - Sorting (`data-s`): per column the rank of the row's value in the order of SR-075 AK1, by the first of several
//   values; `null` for no value, which stays last in both orders. The identifier column ranks every row by
//   `sortElements` (no identifier: by short ID after them), and descending reverses that order wholly, as SR-075 AK1
//   says. Rows of equal rank keep the order of the page, so each call gives the same order.
// - Change since a baseline (SR-233 AK2), when the workspace has one: the baselines newest first in `data-rq-list`
//   (`compare`), each row's change since each of them as an index into `CHANGE_VALUES` (`data-b`, as `baseline.get`
//   names it, SR-232 AK7; "not in the baseline" when the baseline neither lists it nor adds it), and a last column
//   "Change since baseline" written `hidden` and empty: no baseline is chosen at first, so there is no comparison.
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition, propertyWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { SortValue } from "../query/index.js";
import { NO_RANKS, compareSortValues, ranksOf, sortElements, sortValueOf, valuesOf } from "../query/index.js";
import { zip } from "../files/index.js";
import { elementPage, relationText } from "./links.js";
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

const NONE = "–";
const NOT_IN_CORE = "not in the core";

/** The value of one column or filter of a row: its sort value and the text it shows. */
interface Value {
  readonly sort: SortValue;
  readonly text: string;
}

/** A column and filter of the list: its label and the values of an entry (none for an entry without one). */
interface Field {
  readonly label: string;
  /** Whether the list shows it as a column (status, packages, verification status), not only as a filter. */
  readonly column: boolean;
  readonly values: (entry: ListEntry) => readonly Value[];
  /** The cell of an entry, when it is not its values' texts. */
  readonly cell?: (entry: ListEntry) => string;
}

/** The verification status in the core of a requirement, "not in the core" when the core does not hold it. */
export const coreVerification = (element: DataExportElement): string | undefined =>
  element.verification === undefined
    ? undefined
    : (element.verification.find((entry) => entry.view === "core")?.status ?? NOT_IN_CORE);

/** The colour of the badge of each verification status, as the docs' badges name them; another is grey. */
const BADGES: Readonly<Record<string, string>> = {
  verified: "success",
  indirect: "note",
  open: "caution",
  outdated: "danger",
  failed: "danger",
};

/** A badge of the colour `variant` (`BADGES`, `neutral` for grey). */
const badge = (label: string, variant: string): string =>
  `<span class="rq-badge rq-badge-${variant}">${escapeHtml(label)}</span>`;

/** The verification status in the core of a requirement as a badge, with the number of verified criteria of all. */
const verificationBadge = (element: DataExportElement, status: string): string => {
  const criteria = element.verification?.find((entry) => entry.view === "core")?.criteria;
  const label =
    criteria === undefined ? status : `${status} ${String(criteria.verified)}/${String(criteria.total)}`;
  return badge(label, BADGES[status] ?? "neutral");
};

/**
 * The packages of an element: the targets of its property with the meaning `packages`, each by its title, as the
 * sidebar names it, else as `relationText` names it.
 */
const packagesOf = (metamodel: Metamodel, element: DataExportElement): readonly string[] => {
  const key = propertyWithMeaning(metamodel, "packages")?.key;
  return element.relations
    .filter((r) => r.property === true && r.kind === key)
    .map((r) => (r.title === undefined || r.title === "" ? relationText(r) : r.title));
};

const text = (value: string, ranks: ReadonlyMap<string, number> = NO_RANKS): Value => ({
  sort: sortValueOf(value, ranks),
  text: value,
});

/** The fields of the list of `entries`, all of type `type` (see the file comment). */
const fieldsOf = (context: ListContext, type: string, entries: readonly ListEntry[]): Field[] => {
  const { metamodel } = context;
  const statusRanks = ranksOf(metamodel.statuses);
  const fields: Field[] = [
    {
      label: "Status",
      column: true,
      values: ({ element }) => (element.status === undefined ? [] : [text(element.status, statusRanks)]),
    },
    {
      label: "Packages",
      column: true,
      values: ({ element }) => packagesOf(metamodel, element).map((name) => text(name)),
    },
  ];
  if (entries.some(({ element }) => element.verification !== undefined)) {
    fields.push({
      label: "Verification status in the core",
      column: true,
      values: ({ element }) =>
        [coreVerification(element)]
          .filter((status): status is string => status !== undefined)
          .map((status) => text(status)),
      cell: ({ element }) => {
        const status = coreVerification(element);
        return status === undefined ? NONE : verificationBadge(element, status);
      },
    });
  }
  for (const key of findType(metamodel, type)?.properties ?? []) {
    const found = keyDefinition(metamodel, key);
    if (found?.kind === "property" && found.definition.kind === "choice") {
      const ranks = ranksOf(found.definition.choices ?? []);
      fields.push({
        label: found.definition.name,
        column: false,
        values: ({ record }) => valuesOf(record.data[key]).map((v) => text(String(v), ranks)),
      });
    }
  }
  return fields;
};

/** The distinct texts of `field` over `entries`, in ascending order (SR-075 AK1). */
const orderedTexts = (field: Field, entries: readonly ListEntry[]): string[] => {
  const seen = new Map<string, Value>();
  for (const value of entries.flatMap(field.values)) {
    seen.set(value.text, value);
  }
  return [...seen.values()].sort((a, b) => compareSortValues(a.sort, b.sort)).map((v) => v.text);
};

/** The dense rank of each of `values` in ascending order; `null` for none. */
const ranksBy = (values: readonly (SortValue | undefined)[]): (number | null)[] => {
  const order = values
    .map((value, row) => ({ value, row }))
    .filter((v): v is { value: SortValue; row: number } => v.value !== undefined)
    .sort((a, b) => compareSortValues(a.value, b.value));
  const ranks: (number | null)[] = values.map(() => null);
  let rank = -1;
  let last: SortValue | undefined;
  for (const { value, row } of order) {
    if (last === undefined || compareSortValues(last, value) !== 0) {
      rank += 1;
      last = value;
    }
    ranks[row] = rank;
  }
  return ranks;
};

/** The JSON of `value` for an attribute. */
const attribute = (value: unknown): string => escapeHtml(JSON.stringify(value));

/** A column of the list: its label, the sort value and the cell of an entry. */
interface Column {
  readonly label: string;
  /** Descending reverses the whole order (the identifier, SR-075 AK1). */
  readonly total?: true;
  readonly ranks: readonly (number | null)[];
  readonly cell: (entry: ListEntry) => string;
}

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

/** Types in the order of the metamodel's types, a type it does not know after them by its key (SR-075 AK1). */
export const typeOrder = (metamodel: Metamodel): ((a: string, b: string) => number) => {
  const order = new Map(metamodel.effectiveTypes.map((t, i) => [t.key, i]));
  const rank = (type: string): number => order.get(type) ?? order.size;
  return (a, b) => rank(a) - rank(b) || compareSortValues(sortValueOf(a, NO_RANKS), sortValueOf(b, NO_RANKS));
};

/** The list of `sorted`, all of type `type` with a page each, in the order of their identifier (see the file comment). */
export const listPageOf = (
  context: ListContext,
  type: string,
  sorted: readonly ListEntry[],
  compare?: ListCompare,
): ListPage => {
  const comparing = compare !== undefined && compare.baselines.length > 0 ? compare : undefined;
  const fields = fieldsOf(context, type, sorted);
  const facets = zip(
    fields,
    fields.map((field) => orderedTexts(field, sorted)),
  );
  const columns: Column[] = [
    {
      label: "Identifier",
      total: true,
      ranks: sorted.map((_, row) => row),
      cell: ({ element }) =>
        `<a href="../${elementPage(element.id)}">${escapeHtml(identifierOf(element))}</a>`,
    },
    {
      label: "Title",
      ranks: ranksBy(
        sorted.map(({ element }) => (element.title === "" ? undefined : text(element.title).sort)),
      ),
      cell: ({ element }) => escapeHtml(element.title),
    },
    ...fields
      .filter((field) => field.column)
      .map((field): Column => ({
        label: field.label,
        ranks: ranksBy(sorted.map((entry) => field.values(entry)[0]?.sort)),
        cell: (entry) =>
          field.cell?.(entry) ??
          escapeHtml(
            field
              .values(entry)
              .map((v) => v.text)
              .join(", ") || NONE,
          ),
      })),
    {
      label: "Open hints",
      ranks: ranksBy(sorted.map(({ hints }) => sortValueOf(hints, NO_RANKS))),
      cell: ({ hints }) => (hints === 0 ? "" : badge(String(hints), "caution")),
    },
  ];
  const settings = {
    columns: [
      ...columns.map(({ label, total }) => (total === undefined ? { label } : { label, total })),
      ...(comparing === undefined ? [] : [{ label: CHANGE_LABEL }]),
    ],
    filters: facets.map(([field, known]) => ({ label: field.label, values: [...known, NONE] })),
    ...(comparing === undefined
      ? {}
      : { compare: { label: CHANGE_LABEL, baselines: comparing.baselines, values: CHANGE_VALUES } }),
  };
  const rows = sorted.map((entry, row) => {
    const { element } = entry;
    const search = [element.identifier ?? "", element.shortId, element.title]
      .join("\n")
      .normalize("NFC")
      .toLowerCase();
    const indexes = facets.map(([field, known]) => {
      const own = field.values(entry).map((v) => known.indexOf(v.text));
      return own.length === 0 ? [known.length] : [...new Set(own)];
    });
    const ranks = [...columns.map((column) => column.ranks[row]), ...(comparing === undefined ? [] : [null])];
    const cells = [
      ...columns.map((column) => `<td>${column.cell(entry)}</td>`),
      ...(comparing === undefined ? [] : ["<td hidden></td>"]),
    ].join("");
    const change = comparing === undefined ? "" : ` data-b="${attribute(comparing.changeOf(entry.record))}"`;
    return `<tr data-q="${escapeHtml(search)}" data-f="${attribute(indexes)}" data-s="${attribute(ranks)}"${change}>${cells}</tr>`;
  });
  const head = [
    ...columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`),
    ...(comparing === undefined ? [] : [`<th scope="col" hidden>${CHANGE_LABEL}</th>`]),
  ].join("");
  const title = findType(context.metamodel, type)?.name ?? type;
  const body = [
    `<div class="rq-list" data-rq-list="${attribute(settings)}">`,
    `<p class="rq-list-count">${escapeHtml(counted(sorted.length))}</p>`,
    `<div class="rq-list-table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
    "</div>",
  ].join("");
  return { type, path: listPage(type), title, count: sorted.length, body };
};

/** `n elements`. */
const counted = (n: number): string => `${String(n)} ${n === 1 ? "element" : "elements"}`;

/**
 * The types that get a list (see the file comment), each with its elements of `entries`: in the order of the
 * metamodel's types, an unknown type after them by its key.
 */
export const listsOf = (
  context: Pick<ListContext, "metamodel">,
  entries: readonly ListEntry[],
): { readonly type: string; readonly entries: readonly ListEntry[] }[] => {
  const { metamodel } = context;
  const byType = new Map<string, ListEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.record.type) ?? [];
    list.push(entry);
    byType.set(entry.record.type, list);
  }
  return [...byType]
    .filter(([type]) => {
      const meaning = findType(metamodel, type)?.meaning;
      return meaning !== "package" && meaning !== "variant";
    })
    .sort(([a], [b]) => typeOrder(metamodel)(a, b))
    .map(([type, listed]) => ({ type, entries: listed }));
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
  ".rq-list .rq-badge-neutral { --rq-badge-bg: var(--sl-color-gray-6); --rq-badge-border: var(--sl-color-gray-4); --rq-badge-text: var(--sl-color-gray-2); }",
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
  "@media print { .rq-list .rq-list-table { max-height: none; overflow: visible; } }",
];
