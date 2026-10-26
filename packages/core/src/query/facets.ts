// The facets of a selection (`element.facets`, #425): which statuses and which values of which
// properties the selected elements have, with counts, so a caller (the app's "Filter list by
// property") can offer values that select something without counting them itself (ADR-0002).
//
// - Counted exactly as the filter conditions read the elements (condition.ts, property.ts): the
//   status as written; a property's values are `valuesOf` the frontmatter value of ANY element, of
//   whatever type (`eq` and `missing` do not look at the type); an element counts a value once.
//   The properties listed are those a type of a selected element has (metamodel order of the
//   definitions); an element of a type without it counts by the value its file holds (usually none).
// - Every value given is one that `{ property, op: "eq", value }` selects, and selects exactly the
//   elements counted: a relation property gives the short ID of its available targets (the items are
//   read with `validityTarget`, as `eq` reads them), a choice only the values `eq` maps to
//   themselves (a name that `eq` maps to another key, or to several, is not given).
// - Free text: a property of kind text, number or date gives its values only when, over every
//   element of the workspace, it has at most `maxValues` distinct values and one of them is shared
//   by two elements (a title or acceptance criteria are not offered, a topic is, also in a list in
//   which only a few topics are left); the values given are those of the selection. Choice and
//   relation properties always give theirs.
// - `distinct` of free text is exact up to `maxValues`; beyond that counting stops (`distinctCapped`),
//   as nobody uses the number and keeping every title of 50,000 elements costs time (N-036).
// Cost: one pass over the selection, plus one over the store for the free-text rule, which leaves
// a property as soon as it has more than `maxValues` distinct values (N-036). No file is read.
import type { ElementFacetsOutput, MetamodelProperty } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findNamed, findType } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { identifierField, resolveTarget, titleKeyOf } from "../model/index.js";
import { validityTarget } from "../variants/index.js";
import { fold, valuesOf } from "./context.js";
import type { Selected } from "./selection.js";

type Scalar = string | number | boolean;
type Facet = ElementFacetsOutput["properties"][number];
type FacetValue = NonNullable<Facet["values"]>[number];

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** The values of one element, each once: a list may repeat one (a set is made only then, for speed). */
const once = (values: readonly unknown[]): Iterable<unknown> =>
  values.length > 1 ? new Set(values) : values;

/** What is counted for one property. */
interface Tally {
  readonly definition: MetamodelProperty;
  count: number;
  missing: number;
  /** Scalar values (choice; text, number and date when `counted`) by value. */
  readonly scalars: Map<Scalar, number>;
  /** Free text is not counted by value (it gives none); only the distinct values are kept. */
  readonly counted: boolean;
  readonly seen: Set<Scalar>;
  /** Available targets (relation) by repository and UUID. */
  readonly targets: Map<string, { readonly target: ElementRecord; count: number }>;
}

/** The keys of the properties a type of some element has, in the order of the metamodel's definitions. */
const listedProperties = (
  metamodel: Metamodel,
  elements: readonly ElementRecord[],
): readonly MetamodelProperty[] => {
  const keys = new Set<string>();
  for (const type of new Set(elements.map((e) => e.type))) {
    for (const key of findType(metamodel, type)?.properties ?? []) {
      keys.add(key);
    }
  }
  return metamodel.properties.filter((p) => keys.has(p.key));
};

/**
 * The keys of `properties` of kind text, number or date whose values are few over the whole store
 * and shared (see the file comment).
 */
const fewShared = (
  elements: readonly ElementRecord[],
  properties: readonly MetamodelProperty[],
  maxValues: number,
): ReadonlySet<string> => {
  const alive = new Map(
    properties
      .filter((p) => p.kind === "text" || p.kind === "number" || p.kind === "date")
      .map((p) => [p.key, new Map<Scalar, number>()] as const),
  );
  for (const element of elements) {
    for (const [key, seen] of alive) {
      for (const value of once(valuesOf(element.data[key]))) {
        if (isScalar(value)) {
          seen.set(value, (seen.get(value) ?? 0) + 1);
        }
      }
      if (seen.size > maxValues) {
        alive.delete(key);
      }
    }
  }
  return new Set([...alive].filter(([, seen]) => [...seen.values()].some((n) => n >= 2)).map(([key]) => key));
};

/** The available targets the entries of a relation property name, by repository and UUID, each once. */
const targetsOf = (
  selected: Selected,
  element: ElementRecord,
  entries: readonly unknown[],
): ReadonlyMap<string, ElementRecord> => {
  const targets = new Map<string, ElementRecord>();
  for (const entry of entries) {
    const named = validityTarget(entry, element);
    const found = named === undefined ? undefined : resolveTarget(selected.store, element.repository, named);
    if (found?.kind === "found") {
      targets.set(`${found.element.repository}\n${found.element.id}`, found.element);
    }
  }
  return targets;
};

/** Counts the values `stored` of one element under the property of `t`, each once. */
const countValues = (
  selected: Selected,
  element: ElementRecord,
  t: Tally,
  stored: readonly unknown[],
  maxValues: number,
): void => {
  if (t.definition.kind === "relation") {
    for (const [key, target] of targetsOf(selected, element, stored)) {
      const entry = t.targets.get(key);
      if (entry === undefined) {
        t.targets.set(key, { target, count: 1 });
      } else {
        entry.count += 1;
      }
    }
    return;
  }
  for (const value of once(stored)) {
    if (!isScalar(value)) {
      continue;
    }
    if (t.counted) {
      t.scalars.set(value, (t.scalars.get(value) ?? 0) + 1);
    } else if (t.seen.size <= maxValues) {
      t.seen.add(value);
    }
  }
};

/** Counts the status and the values of `properties` of every element in one pass. */
const tally = (
  selected: Selected,
  properties: readonly MetamodelProperty[],
  few: ReadonlySet<string>,
  maxValues: number,
): { readonly statuses: ReadonlyMap<string, number>; readonly tallies: readonly Tally[] } => {
  const statuses = new Map<string, number>();
  const tallies: Tally[] = properties.map((definition) => ({
    definition,
    count: 0,
    missing: 0,
    scalars: new Map(),
    counted: definition.kind === "choice" || few.has(definition.key),
    seen: new Set(),
    targets: new Map(),
  }));
  for (const element of selected.elements) {
    const status = element.data["status"];
    if (typeof status === "string") {
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
    for (const t of tallies) {
      const stored = valuesOf(element.data[t.definition.key]);
      if (stored.length === 0) {
        t.missing += 1;
        continue;
      }
      t.count += 1;
      countValues(selected, element, t, stored, maxValues);
    }
  }
  return { statuses, tallies };
};

/** Texts ignoring case, ties by code units; the texts compared are different. */
const compareText = (a: string, b: string): number => {
  const [folded, other] = [fold(a), fold(b)];
  return folded === other ? Number(a > b) - Number(a < b) : Number(folded > other) - Number(folded < other);
};

/** Numbers ascending, then texts (`compareText`), then booleans (false first). */
const compareScalars = (a: Scalar, b: Scalar): number => {
  if (typeof a === "string" && typeof b === "string") {
    return compareText(a, b);
  }
  const rank = (v: Scalar): number => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  return rank(a) === rank(b) ? Number(a) - Number(b) : rank(a) - rank(b);
};

/**
 * Whether `{ property, op: "eq", value }` selects a stored value that is no key of the choices: only
 * a value that names no choice (taken as written). A name `eq` maps to another key or to several
 * selects the elements of those keys, not this one.
 */
const takenAsWritten = (definition: MetamodelProperty, value: Scalar): boolean =>
  typeof value !== "string" || findNamed(definition.choices ?? [], value).kind === "unknown";

/** The values of a choice property: its choices in metamodel order, then other values as written. */
const choiceValues = (t: Tally): readonly FacetValue[] => {
  const { definition, scalars } = t;
  const choices = definition.choices ?? [];
  const keys: ReadonlySet<unknown> = new Set(choices.map((c) => c.key));
  return [
    ...choices.flatMap((c) => {
      const count = scalars.get(c.key);
      return count === undefined ? [] : [{ value: c.key, count, name: c.name }];
    }),
    ...[...scalars]
      .filter(([value]) => !keys.has(value) && takenAsWritten(definition, value))
      .map(([value, count]) => ({ value, count })),
  ];
};

const sortKey = ({ title, value }: { readonly title?: string; readonly value: string }): string =>
  `${title ?? ""}\n${value}`;

/** The available targets of a relation property, by title ignoring case, then short ID. */
const targetValues = (selected: Selected, t: Tally): readonly FacetValue[] => {
  const { metamodel, shortIds } = selected;
  const titleKey = titleKeyOf(metamodel);
  return [...t.targets.values()]
    .map(({ target, count }) => {
      const title = titleKey === undefined ? undefined : target.data[titleKey];
      return {
        value: shortIds.of(target),
        count,
        ...(typeof title === "string" ? { title } : {}),
        ...identifierField(shortIds, target),
      };
    })
    .sort((a, b) => compareText(sortKey(a), sortKey(b)));
};

/** The values of text, number and date, sorted (see `compareScalars`). */
const plainValues = (t: Tally): readonly FacetValue[] =>
  [...t.scalars].sort(([a], [b]) => compareScalars(a, b)).map(([value, count]) => ({ value, count }));

/** The facet of one property. */
const facetOf = (selected: Selected, t: Tally, few: ReadonlySet<string>, maxValues: number): Facet => {
  const { key, name, kind } = t.definition;
  const head = { key, name, kind, count: t.count, missing: t.missing };
  if (kind === "relation") {
    const values = targetValues(selected, t);
    return { ...head, distinct: values.length, values };
  }
  if (kind === "choice") {
    const values = choiceValues(t);
    return { ...head, distinct: values.length, values };
  }
  return {
    ...head,
    distinct: t.counted ? t.scalars.size : t.seen.size,
    ...(t.counted || t.seen.size <= maxValues ? {} : { distinctCapped: true }),
    ...(few.has(key) ? { values: plainValues(t) } : {}),
  };
};

/**
 * The statuses and property facets of `selected` (see the file comment); `maxValues` is the
 * threshold of the free-text rule.
 */
export const facetsOf = (
  selected: Selected,
  maxValues: number,
): Pick<ElementFacetsOutput, "statuses" | "properties"> => {
  const { metamodel, store, elements } = selected;
  const properties = listedProperties(metamodel, elements);
  const few = fewShared(store.elements, properties, maxValues);
  const { statuses, tallies } = tally(selected, properties, few, maxValues);
  const order = new Map(metamodel.statuses.map((s, i) => [s.key, i]));
  const rank = (key: string): number => order.get(key) ?? order.size;
  return {
    // Metamodel order, then the other statuses in store order (the sort is stable).
    statuses: [...statuses].map(([key, count]) => ({ key, count })).sort((a, b) => rank(a.key) - rank(b.key)),
    properties: tallies.map((t) => facetOf(selected, t, few, maxValues)),
  };
};
