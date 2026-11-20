// The lists of the HTML export (SR-233 AK1, AK5): one page `lists/<type key>.html` per type with at least one element
// that has a page (no invalid status, D-044), except the types with the meaning package or variant, in the order of
// the metamodel's types (an unknown type after them by its key). The page is the whole list as a table, so it stands
// there without script (AK5); `assets/list.js` (`list-script.ts`) adds the search field, the filters, the sorting and
// the grouping on top of it.
//
// - Rows, in the order of their identifier (`sortElements` by `identifier`, as `element.list` sorts): identifier
//   (else the short ID) as a link to the page, title, status ("–" without one), for a requirement type the
//   verification status in the core ("not in the core" when the core does not hold it), packages, and the number of
//   open hints of the element (`hint.list`).
// - Search: each row carries its identifier, short ID and title folded (NFC, lower case) in `data-q`.
// - Filters (`data-f`): status, packages, the verification status in the core and each property of kind `choice` the
//   type has, in this order. Each filter lists its values in the order of SR-075 AK1 (`sortValueOf`: the metamodel's
//   order for statuses and choices, then numbers, then text ignoring case), "–" for an element without one last; a
//   row names the index of each of its values, so a row with several packages stands in each of them.
// - Sorting (`data-s`): per column the rank of the row's value in the order of SR-075 AK1, by the first of several
//   values; `null` for no value, which stays last in both orders. The identifier column ranks every row by
//   `sortElements` (no identifier: by short ID after them), and descending reverses that order wholly, as SR-075 AK1
//   says. Rows of equal rank keep the order of the page, so each call gives the same order.
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
}

/** The verification status in the core of a requirement, "not in the core" when the core does not hold it. */
export const coreVerification = (element: DataExportElement): string | undefined =>
  element.verification === undefined
    ? undefined
    : (element.verification.find((entry) => entry.view === "core")?.status ?? NOT_IN_CORE);

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
export const listPageOf = (context: ListContext, type: string, sorted: readonly ListEntry[]): ListPage => {
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
      cell: ({ hints }) => String(hints),
    },
  ];
  const settings = {
    columns: columns.map(({ label, total }) => (total === undefined ? { label } : { label, total })),
    filters: facets.map(([field, known]) => ({ label: field.label, values: [...known, NONE] })),
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
    const ranks = columns.map((column) => column.ranks[row]);
    const cells = columns.map((column) => `<td>${column.cell(entry)}</td>`).join("");
    return `<tr data-q="${escapeHtml(search)}" data-f="${attribute(indexes)}" data-s="${attribute(ranks)}">${cells}</tr>`;
  });
  const head = columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("");
  const title = findType(context.metamodel, type)?.name ?? type;
  const body = [
    `<div class="rq-list" data-rq-list="${attribute(settings)}">`,
    `<p class="rq-list-count">${escapeHtml(counted(sorted.length))}</p>`,
    `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`,
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

/** The styles of the lists. */
export const LIST_CSS = [
  ".rq-list table { display: table; width: 100%; }",
  ".rq-list-count { color: var(--sl-color-gray-3); font-size: var(--sl-text-sm); }",
  ".rq-list th button { all: inherit; cursor: pointer; display: inline-flex; gap: 0.25rem; align-items: center; }",
  ".rq-list th[aria-sort=ascending] button::after { content: '▲'; font-size: 0.7em; }",
  ".rq-list th[aria-sort=descending] button::after { content: '▼'; font-size: 0.7em; }",
  ".rq-list tr.rq-group th { background: var(--sl-color-gray-6); font-weight: 600; }",
  ".rq-list-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 1rem; }",
  ".rq-list-bar input[type=search] { flex: 1 1 16rem; padding: 0.4rem 0.6rem; border: 1px solid var(--sl-color-gray-5); border-radius: 0.5rem; background: var(--sl-color-black); color: var(--sl-color-white); }",
  ".rq-chip { position: relative; }",
  ".rq-chip > summary { list-style: none; cursor: pointer; border: 1px solid var(--sl-color-gray-5); border-radius: 999px; padding: 0.15rem 0.7rem; font-size: var(--sl-text-sm); }",
  ".rq-chip > summary::-webkit-details-marker { display: none; }",
  ".rq-chip.rq-on > summary { border-color: var(--sl-color-text-accent); color: var(--sl-color-text-accent); }",
  ".rq-chip-values { position: absolute; z-index: 10; min-width: 14rem; max-height: 20rem; overflow-y: auto; margin-top: 0.25rem; padding: 0.4rem; background: var(--sl-color-bg); border: 1px solid var(--sl-color-gray-5); border-radius: 0.5rem; box-shadow: var(--sl-shadow-md); }",
  ".rq-chip-values label { display: flex; gap: 0.5rem; align-items: center; font-size: var(--sl-text-sm); }",
  ".rq-chip-values .rq-n { margin-inline-start: auto; color: var(--sl-color-gray-3); }",
  ".rq-tokens { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; font-size: var(--sl-text-sm); }",
  ".rq-tokens button { border: 1px solid var(--sl-color-gray-5); border-radius: 999px; background: none; color: inherit; padding: 0.1rem 0.6rem; cursor: pointer; }",
];
