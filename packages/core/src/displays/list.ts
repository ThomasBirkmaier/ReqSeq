// The display model of a list of elements of one type (SR-233 AK1, AK5; ADR-0019 points 1, 2, 7, 9(a)): its columns,
// its filters with their values in order, and per row its cells, its search text, the values it stands in per filter
// and its rank per column. The HTML export's list pages render it, and `assets/list.js` takes the groups (the values
// of a filter) and the ranks from it; the app's lists do not use it yet.
//
// - Rows: in the order given; the order of the identifier, which needs the store, stays with the caller
//   (`element.list` `sort`, the export's `sortedByIdentifier`, ADR-0019 point 3).
// - Columns: identifier (option `id`: "identifier", the identifier else the short ID, SR-233 AK1; "shownId", the
//   short ID with the identifier, SR-084 AK4), title, status, packages, for a type with the meaning requirement the
//   verification status, and the number of open hints. The verification cell is the one of the list's view (the
//   core in every export list): a requirement outside that view shows none (SR-137 AK4, SR-233 AK1).
// - Filters: status, packages, the verification status and each property of kind `choice` of the type, in this
//   order. Each lists its values in the order of SR-075 AK1, then `EMPTY_VALUE` for a row without one; a row with
//   several values stands in each.
// - Ranks: per column the dense rank of the row's first value in the order of SR-075 AK1, `null` without a value;
//   the identifier column ranks by row position (descending reverses it wholly, `total`). The order of values is the
//   caller's rule (`ListOrder`), since it lives in the query block; the builder sorts once per column.
import type { DataExportElement, MetamodelGetOutput } from "../generated/types.js";
import { fold } from "../query/fold.js";
import type { ElementRef } from "./element-ref.js";
import { elementRef, invalidStatusKeys } from "./element-ref.js";
import { EMPTY_VALUE, shownId } from "./labels.js";
import { relationText } from "./relation-text.js";
import type { VerificationCell } from "./verification.js";
import { verificationLabel } from "./verification.js";

/** One row as `element.list` gives it (`elements[]`), with its verification in the list's view and its open hints. */
export interface ListRowInput {
  readonly element: Pick<
    DataExportElement,
    | "id"
    | "repository"
    | "shortId"
    | "identifier"
    | "type"
    | "status"
    | "title"
    | "file"
    | "properties"
    | "relations"
  >;
  /** The verification in the list's view (`rowVerification[].verification`); none outside it. */
  readonly verification?: readonly VerificationCell[] | undefined;
  /** The number of its open hints (`hint.list`). */
  readonly hints: number;
}

/** What the list reads of `metamodel.get`. */
export interface ListMetamodel {
  readonly types: readonly Pick<
    MetamodelGetOutput["types"][number],
    "key" | "name" | "meaning" | "properties"
  >[];
  readonly properties: readonly Pick<
    MetamodelGetOutput["properties"][number],
    "key" | "name" | "kind" | "meaning" | "choices"
  >[];
  readonly statuses: readonly Pick<MetamodelGetOutput["statuses"][number], "key" | "invalid">[];
}

/** The fields whose values a filter or a column orders. */
export type ListField =
  | { readonly kind: "status" }
  | { readonly kind: "packages" }
  | { readonly kind: "verification" }
  | { readonly kind: "choice"; readonly key: string; readonly choices: readonly { readonly key: string }[] }
  | { readonly kind: "title" }
  | { readonly kind: "hints" };

/**
 * The order of the values of a field (SR-075 AK1): the caller's rule, as the query block gives it. `keyOf` is asked
 * once per distinct value of a field.
 */
export interface ListOrder<K> {
  readonly keyOf: (field: ListField, value: string) => K;
  readonly compare: (a: K, b: K) => number;
}

export interface ListOptions<K> {
  /** "identifier" for the export's lists (SR-233 AK1), "shownId" for the app's (SR-084 AK4). */
  readonly id: "identifier" | "shownId";
  readonly order: ListOrder<K>;
}

export interface ListColumnDisplay {
  readonly label: string;
  /** Descending reverses the whole order (the identifier, SR-075 AK1). */
  readonly total?: true;
}

export interface ListFilterDisplay {
  readonly label: string;
  /** In the order of SR-075 AK1, then `EMPTY_VALUE`: the groups of the list in this order. */
  readonly values: readonly string[];
}

/** A cell of a row: plain text, the verification in the list's view, or the number of open hints. */
export type ListCell =
  | { readonly kind: "id"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "verification"; readonly cell: VerificationCell | undefined; readonly text: string }
  | { readonly kind: "hints"; readonly count: number };

export interface ListRowDisplay {
  readonly ref: ElementRef;
  /** Identifier, short ID and title, folded (NFC, lower case), one per line. */
  readonly search: string;
  /** In the order of `columns`. */
  readonly cells: readonly ListCell[];
  /** Per filter, the indexes into its `values` the row stands in. */
  readonly facets: readonly (readonly number[])[];
  /** Per column, its rank; `null` without a value. */
  readonly ranks: readonly (number | null)[];
}

export interface ListDisplay {
  readonly type: string;
  /** The name of the type, else its key. */
  readonly title: string;
  readonly columns: readonly ListColumnDisplay[];
  readonly filters: readonly ListFilterDisplay[];
  readonly rows: readonly ListRowDisplay[];
}

/** A filter or column field of the list: its label, what it orders by, whether it is a column, the values of a row. */
interface Field {
  readonly label: string;
  readonly field: ListField;
  readonly column: boolean;
  readonly values: (row: ListRowInput) => readonly string[];
}

/** The targets of the property with the meaning `packages`, each by its title, as the sidebar names it, else as `relationText` names it. */
const packagesOf = (key: string | undefined, element: ListRowInput["element"]): string[] =>
  element.relations
    .filter((r) => r.property === true && r.kind === key)
    .map((r) => (r.title === undefined || r.title === "" ? relationText(r) : r.title));

/** The verification cell of a row, the first of its view. */
const cellOf = (row: ListRowInput): VerificationCell | undefined => row.verification?.[0];

const fieldsOf = (metamodel: ListMetamodel, type: string): Field[] => {
  const definition = metamodel.types.find((t) => t.key === type);
  const packages = metamodel.properties.find((p) => p.meaning === "packages")?.key;
  const fields: Field[] = [
    {
      label: "Status",
      field: { kind: "status" },
      column: true,
      values: ({ element }) => (element.status === undefined ? [] : [element.status]),
    },
    {
      label: "Packages",
      field: { kind: "packages" },
      column: true,
      values: ({ element }) => packagesOf(packages, element),
    },
  ];
  if (definition?.meaning === "requirement") {
    fields.push({
      label: "Verification status in the core",
      field: { kind: "verification" },
      column: true,
      values: (row) => {
        const cell = cellOf(row);
        return cell === undefined ? [] : [cell.status];
      },
    });
  }
  for (const key of definition?.properties ?? []) {
    const property = metamodel.properties.find((p) => p.key === key);
    if (property?.kind === "choice") {
      fields.push({
        label: property.name,
        field: { kind: "choice", key, choices: property.choices ?? [] },
        column: false,
        values: ({ element }) => valuesOf(element.properties[key]).map(String),
      });
    }
  }
  return fields;
};

/** The values of a property: a list as it is, nothing for none, else the one value. */
const valuesOf = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) {
    return value as unknown[];
  }
  return value === undefined || value === null ? [] : [value];
};

/** The distinct `texts` with their keys by `order` for `field`, sorted once; `keyOf` is asked once each. */
const sortedOf = <K>(
  order: ListOrder<K>,
  field: ListField,
  texts: Iterable<string>,
): { readonly text: string; readonly key: K }[] =>
  [...texts]
    .map((text) => ({ text, key: order.keyOf(field, text) }))
    .sort((a, b) => order.compare(a.key, b.key));

/**
 * The dense rank of each text of `sorted` that `ranked` holds (all when it is not given), by walking `sorted` once:
 * two texts the order holds equal get one rank.
 */
const denseRanksOf = <K>(
  order: ListOrder<K>,
  sorted: readonly { readonly text: string; readonly key: K }[],
  ranked?: ReadonlySet<string>,
): Map<string, number> => {
  const ranks = new Map<string, number>();
  let previous: { readonly key: K } | null = null;
  let rank = -1;
  for (const entry of sorted) {
    if (ranked !== undefined && !ranked.has(entry.text)) {
      continue;
    }
    if (previous === null || order.compare(previous.key, entry.key) !== 0) {
      rank += 1;
      previous = entry;
    }
    ranks.set(entry.text, rank);
  }
  return ranks;
};

/** A field while one list is built: the values seen, the first values of the rows, and then their order. */
interface FieldState {
  readonly field: Field;
  readonly seen: Set<string>;
  readonly firsts: Set<string>;
  /** The values of the filter in order, `EMPTY_VALUE` last; filled after the rows are read. */
  values: readonly string[];
  index: ReadonlyMap<string, number>;
  ranks: ReadonlyMap<string, number>;
}

/** The rank of `value` in `ranks`, `null` for none; every value given was ranked. */
const rankOf = (ranks: ReadonlyMap<string, number>, value: string | undefined): number | null =>
  value === undefined ? null : Number(ranks.get(value));

/** The display model of the list of `rows`, all of type `type` (see the file comment). */
export const listDisplay = <K>(
  input: { readonly type: string; readonly rows: readonly ListRowInput[]; readonly metamodel: ListMetamodel },
  options: ListOptions<K>,
): ListDisplay => {
  const { type, rows, metamodel } = input;
  const { order } = options;
  const invalid = invalidStatusKeys(metamodel);
  const states: FieldState[] = fieldsOf(metamodel, type).map((field) => ({
    field,
    seen: new Set(),
    firsts: new Set(),
    values: [],
    index: new Map(),
    ranks: new Map(),
  }));
  const titles = new Set<string>();
  const hints = new Set<string>();
  const read = rows.map((row) => {
    const { title } = row.element;
    if (title !== "") {
      titles.add(title);
    }
    hints.add(String(row.hints));
    const pairs = states.map((state) => {
      const texts = state.field.values(row);
      for (const text of texts) {
        state.seen.add(text);
      }
      const [first] = texts;
      if (first !== undefined) {
        state.firsts.add(first);
      }
      return { state, texts, first };
    });
    return { row, pairs };
  });
  for (const state of states) {
    const sorted = sortedOf(order, state.field.field, state.seen);
    const values = sorted.map(({ text }) => text);
    // The index of the values seen, before "–" is appended: a real value "–" keeps its own place.
    state.index = new Map(values.map((value, at) => [value, at]));
    state.values = [...values, EMPTY_VALUE];
    state.ranks = state.field.column ? denseRanksOf(order, sorted, state.firsts) : new Map();
  }
  const titleRanks = denseRanksOf(order, sortedOf(order, { kind: "title" }, titles));
  const hintRanks = denseRanksOf(order, sortedOf(order, { kind: "hints" }, hints));
  const shown = states.filter((state) => state.field.column);
  return {
    type,
    title: metamodel.types.find((t) => t.key === type)?.name ?? type,
    columns: [
      { label: "Identifier", total: true },
      { label: "Title" },
      ...shown.map(({ field }) => ({ label: field.label })),
      { label: "Open hints" },
    ],
    filters: states.map(({ field, values }) => ({ label: field.label, values })),
    rows: read.map(({ row, pairs }, at) => {
      const { element } = row;
      const columns = pairs.filter(({ state }) => state.field.column);
      const id =
        options.id === "identifier"
          ? (element.identifier ?? element.shortId)
          : shownId(element.shortId, element.identifier);
      const cells: ListCell[] = [
        { kind: "id", text: id },
        { kind: "text", text: element.title },
        ...columns.map(({ state, texts }): ListCell => {
          if (state.field.field.kind === "verification") {
            const cell = cellOf(row);
            return {
              kind: "verification",
              cell,
              text: cell === undefined ? EMPTY_VALUE : verificationLabel(cell, "short"),
            };
          }
          return { kind: "text", text: texts.length === 0 ? EMPTY_VALUE : texts.join(", ") };
        }),
        { kind: "hints", count: row.hints },
      ];
      return {
        ref: elementRef(element, invalid),
        search: fold([element.identifier ?? "", element.shortId, element.title].join("\n")),
        cells,
        facets: pairs.map(({ state, texts }) =>
          texts.length === 0
            ? [state.values.length - 1]
            : [...new Set(texts.map((text) => Number(state.index.get(text))))],
        ),
        ranks: [
          at,
          rankOf(titleRanks, element.title === "" ? undefined : element.title),
          ...columns.map(({ state, first }) => rankOf(state.ranks, first)),
          rankOf(hintRanks, String(row.hints)),
        ],
      };
    }),
  };
};
