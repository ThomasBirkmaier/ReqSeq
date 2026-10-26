// Sorting a selection (SR-075, D-031): "Das Tool muss Listen nach Properties oder nach der Hierarchie
// der Ableitungen ordnen, ohne eine feste Reihenfolge zu speichern." The order is computed for each
// call from what the files hold; nothing about it is ever written (AK3: `element.list` only reads).
//
// - Keys (`filter.schema.json#/$defs/sortKey`) apply in order; elements equal under every key keep
//   the workspace order (the order of the store, as without `sort`).
// - `id`: the short ID (SR-084). `type`: the order of the types in the metamodel, a type it does not
//   know after them by its key. `status`: the order of the statuses in the metamodel. `title`: the
//   property with the meaning `title` (`metamodel.meaning-unassigned` without one, SR-013 AK3).
//   Any other key (AK1 "nach einer Property", known to the metamodel or not, SR-016): its first value
//   (`valuesOf`: a list by its first item). A key that holds relations (a relation kind, `validity`,
//   `packages`) has element references, not values to order: `input.invalid`.
// - Values: the choices of a property of kind `choice` (and the types and statuses above) in the
//   order the metamodel defines them, then numbers, then texts, then booleans (false before true).
//   Texts compare ignoring case (NFC, lower case, by code units; equal ones by the text as written).
//   No value (absent, `null`, `[]`, a mapping, NaN) comes last in both orders; `desc` reverses
//   everything else.
// - `hierarchy` (AK2 "als Baum nach ihren Ableitungen"; spec-frage #354, option 1): only as the
//   first key and only ascending; the keys after it order the roots and the elements below each
//   parent. The tree holds exactly the elements of the selection, each once. Parents are an
//   element's own derivation items (relation kinds with the meaning `derivation`, SR-013) whose
//   target is available and in the selection, as the chain goes up (`parentPositions`); the
//   incoming index is not needed, so a one-shot CLI call does not build it. Breadth first from the
//   roots (the elements without a parent in the selection), each element is placed below the
//   parent that reaches it first: at its shortest depth, the first in sort order among equals, as
//   `trace.chain` places each element once at its shortest depth. Every element is listed once, so
//   the tree stops at a cycle as the chain does (cycles are reported by `workspace.check`, SR-090,
//   and `trace.chain`, SR-022 AK4). What no root reaches lies on or below a cycle (every other
//   element has a parent in the selection): each such cycle that nothing else left over leads into
//   (`cyclesOf`, the strongly connected components of SR-090) becomes a root at its first element
//   in sort order, and the rest hangs below these. The list is the tree depth first.
// - Cost (N-036, SR-082 AK4): one value per key and element, one sort. For `hierarchy` the parents
//   of every element of the store as store positions, once per store (`parentPositions`, kept in
//   `PARENTS`; a change of the files makes a new store, which gets its own), then one pass over the
//   store and linear passes over the selection that link the elements by array positions: looking
//   up the 128,000 parents of N-036 as records on every call cost several times as much.
import type { CommandName } from "../catalog.js";
import type { FilterSortKeyWithDefaults } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { keyDefinition, meaningUnassigned } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import { relationKey, titleKeyOf } from "../model/index.js";
import type { Cycle, ParentPositions } from "../trace/index.js";
import { cyclesOf, derivationKinds, parentPositions } from "../trace/index.js";
import { fold, invalidAt, valuesOf } from "./context.js";

/** The states a sort reads; `shortIds` must be those of `store`. */
export interface SortContext {
  readonly command: CommandName;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** The place of an element in the derivation tree (`hierarchy`). */
export interface TreePlace {
  readonly element: ElementRecord;
  /** 0 for a root. */
  readonly depth: number;
  /** The element it is shown below; undefined for a root. */
  readonly parent: ElementRecord | undefined;
}

export interface SortedElements {
  readonly elements: readonly ElementRecord[];
  /** With `hierarchy` only: the place of each element of `elements`, in the same order. */
  readonly tree?: readonly TreePlace[];
}

/** The kinds of a sort value, in ascending order; `NONE` comes last in both orders. */
const RANKED = 0;
const NUMBER = 1;
const TEXT = 2;
const BOOLEAN = 3;
const NONE = 4;

/** The value of one element under one key, linked to its value under the next key. */
interface Cell {
  readonly kind: number;
  /** The rank (RANKED), the number (NUMBER) or 0 and 1 (BOOLEAN). */
  readonly number: number;
  /** The folded text (TEXT). */
  readonly text: string;
  /** The text as written (TEXT), for texts equal when folded. */
  readonly raw: string;
  /** 1 for `asc`, -1 for `desc`. */
  readonly sign: number;
  readonly next: Cell | undefined;
}

/** An element with its values under every key and its position in the workspace order. */
interface Row {
  readonly element: ElementRecord;
  readonly position: number;
  readonly first: Cell | undefined;
}

/** How one key gives the cell of an element: its sort value with `sign`, linked to `next`. */
type Column = (element: ElementRecord, sign: number, next: Cell | undefined) => Cell;

/** The cell of `value`; a text that names an entry of `ranks` is ranked by it. */
const cellOf = (
  value: unknown,
  ranks: ReadonlyMap<string, number>,
  sign: number,
  next: Cell | undefined,
): Cell => {
  if (typeof value === "string") {
    const rank = ranks.get(value);
    return rank === undefined
      ? { kind: TEXT, number: 0, text: fold(value), raw: value, sign, next }
      : { kind: RANKED, number: rank, text: "", raw: "", sign, next };
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return { kind: NUMBER, number: value, text: "", raw: "", sign, next };
  }
  if (typeof value === "boolean") {
    return { kind: BOOLEAN, number: value ? 1 : 0, text: "", raw: "", sign, next };
  }
  return { kind: NONE, number: 0, text: "", raw: "", sign, next };
};

const NO_RANKS: ReadonlyMap<string, number> = new Map();

const ranksOf = (keys: readonly { readonly key: string }[]): ReadonlyMap<string, number> =>
  new Map(keys.map((entry, rank) => [entry.key, rank]));

/** How one key reads the sort value of an element (see the file comment). */
const columnOf = (context: SortContext, by: string, at: string): Column => {
  const { metamodel, shortIds } = context;
  switch (by) {
    case "id":
      return (element, sign, next) => cellOf(shortIds.of(element), NO_RANKS, sign, next);
    case "type": {
      const ranks = ranksOf(metamodel.effectiveTypes);
      return (element, sign, next) => cellOf(element.type, ranks, sign, next);
    }
    case "status": {
      const ranks = ranksOf(metamodel.statuses);
      return (element, sign, next) => cellOf(valuesOf(element.data["status"])[0], ranks, sign, next);
    }
    case "title": {
      const key = titleKeyOf(metamodel);
      if (key === undefined) {
        throw meaningUnassigned("title", context.command);
      }
      return (element, sign, next) => cellOf(valuesOf(element.data[key])[0], NO_RANKS, sign, next);
    }
  }
  const relation = relationKey(metamodel, by);
  if (relation !== undefined) {
    throw invalidAt(
      context,
      at,
      `${relation.label} holds relations, which have no order; sort by hierarchy or by another property`,
    );
  }
  const found = keyDefinition(metamodel, by);
  const choices = found?.kind === "property" ? found.definition.choices : undefined;
  const ranks = choices === undefined ? NO_RANKS : ranksOf(choices);
  return (element, sign, next) => cellOf(valuesOf(element.data[by])[0], ranks, sign, next);
};

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareNumber = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

/** How two values of one key compare (see the file comment). */
const compareCells = (x: Cell, y: Cell): number => {
  if (x.kind !== y.kind) {
    if (x.kind === NONE) {
      return 1;
    }
    if (y.kind === NONE) {
      return -1;
    }
    return (x.kind - y.kind) * x.sign;
  }
  const order =
    x.kind === TEXT
      ? compareText(x.text, y.text) || compareText(x.raw, y.raw)
      : compareNumber(x.number, y.number);
  return order * x.sign;
};

/** How two rows compare: key by key, then by the workspace order. */
const compareRows = (a: Row, b: Row): number => {
  let x = a.first;
  let y = b.first;
  while (x !== undefined && y !== undefined) {
    const order = compareCells(x, y);
    if (order !== 0) {
      return order;
    }
    x = x.next;
    y = y.next;
  }
  return a.position - b.position;
};

/** The parents of every element of a store by position, with the metamodel they were read with. */
interface KeptParents {
  readonly metamodel: Metamodel;
  readonly entries: readonly ParentPositions[];
}

/** `parentPositions` per store (see the file comment): a store never changes; a change makes a new one. */
const PARENTS = new WeakMap<ElementStore, KeptParents>();

const keptParents = (context: SortContext): readonly ParentPositions[] => {
  const kept = PARENTS.get(context.store);
  if (kept?.metamodel === context.metamodel) {
    return kept.entries;
  }
  const graph = { kinds: derivationKinds(context.metamodel, context.command), store: context.store };
  const entries = parentPositions(graph);
  PARENTS.set(context.store, { metamodel: context.metamodel, entries });
  return entries;
};

/** A row of the derivation tree: an element of the list and its node while the tree is built. */
interface TreeRow extends Row {
  /** The store positions of its available parents (`parentPositions`). */
  readonly parents: readonly number[];
  /** Its children within the list, in sort order; a child once (`NO_ROWS` until it has one). */
  children: TreeRow[];
  /** The rows placed below it, in sort order (`NO_ROWS` until it has one). */
  below: TreeRow[];
  /** Where it is placed, once it is (`TreePlace`), and whether it is a root. */
  depth: number;
  parent: ElementRecord | undefined;
  placed: boolean;
  top: boolean;
}

/** No rows: shared by the rows without children, replaced at the first one (fewer arrays at N-036). */
const NO_ROWS: TreeRow[] = [];

/**
 * The rows of `elements` (in store order) with their parents, and the row at each store position
 * (undefined for an element not in the list). Walks the store and the elements side by side: no
 * lookup per element.
 */
const treeRowsOf = (
  context: SortContext,
  elements: readonly ElementRecord[],
  cellsOf: (element: ElementRecord) => Cell | undefined,
): { readonly rows: TreeRow[]; readonly at: readonly (TreeRow | undefined)[] } => {
  const rows: TreeRow[] = [];
  const at: (TreeRow | undefined)[] = [];
  for (const { element, parents } of keptParents(context)) {
    if (element !== elements[rows.length]) {
      at.push(undefined);
      continue;
    }
    const row: TreeRow = {
      element,
      position: rows.length,
      first: cellsOf(element),
      parents,
      children: NO_ROWS,
      below: NO_ROWS,
      depth: 0,
      parent: undefined,
      placed: false,
      top: false,
    };
    rows.push(row);
    at.push(row);
  }
  if (rows.length !== elements.length) {
    throw new Error("sortElements: the elements must be records of the store, in store order");
  }
  return { rows, at };
};

/** The derivation tree of the sorted `rows`, depth first (see the file comment). */
const treeOf = (rows: readonly TreeRow[], at: readonly (TreeRow | undefined)[]): TreePlace[] => {
  const roots: TreeRow[] = [];
  for (const row of rows) {
    let parented = false;
    for (const position of row.parents) {
      const above = at[position];
      if (above === undefined) {
        continue;
      }
      parented = true;
      if (above.children === NO_ROWS) {
        above.children = [row];
      } else if (above.children.at(-1) !== row) {
        // A parent named twice (two items or two relation kinds) is one parent.
        above.children.push(row);
      }
    }
    if (!parented) {
      roots.push(row);
    }
  }
  // Breadth first from `starts`, so that each element is placed at its shortest depth.
  const spread = (starts: readonly TreeRow[]): void => {
    for (const start of starts) {
      start.placed = true;
      start.top = true;
    }
    const queue = [...starts];
    // The queue grows while it is read: an array iterator reads its length at every step.
    for (const row of queue) {
      for (const child of row.children) {
        if (!child.placed) {
          child.placed = true;
          child.depth = row.depth + 1;
          child.parent = row.element;
          if (row.below === NO_ROWS) {
            row.below = [child];
          } else {
            row.below.push(child);
          }
          queue.push(child);
        }
      }
    }
  };
  spread(roots);
  // What no root reaches lies on or below a cycle (see the file comment): every element of the list
  // that is not a root has a parent in the list. Each cycle that nothing else left over leads into
  // is entered at its first element in sort order; from there everything left over is reached.
  const left = rows.filter((row) => !row.placed);
  const edges = left.flatMap((from) =>
    from.children.flatMap((to) => (to.placed ? [] : [{ from: from.element, to: to.element, link: from }])),
  );
  const cycles = cyclesOf(
    left.map((row) => row.element),
    edges,
  );
  const cycleOf = new Map(
    cycles.flatMap((cycle) => cycle.elements.map((element) => [element, cycle] as const)),
  );
  const entered = new Set<Cycle<unknown>>();
  for (const { from, to } of edges) {
    const cycle = cycleOf.get(to);
    if (cycle !== undefined && cycleOf.get(from) !== cycle) {
      entered.add(cycle);
    }
  }
  const entries = new Set(cycles.flatMap((cycle) => (entered.has(cycle) ? [] : cycle.elements.slice(0, 1))));
  spread(left.filter((row) => entries.has(row.element)));
  // Depth first from the roots in sort order, those of the cycles among them.
  const stack = rows.filter((row) => row.top).reverse();
  const order: TreePlace[] = [];
  for (let row = stack.pop(); row !== undefined; row = stack.pop()) {
    order.push({ element: row.element, depth: row.depth, parent: row.parent });
    // `below` is not read again: reversed in place.
    for (const child of row.below.reverse()) {
      stack.push(child);
    }
  }
  return order;
};

/**
 * `elements` sorted by `keys` for `context.command`, and with `hierarchy` the place of each in the
 * derivation tree (see the file comment). `elements` must be records of `context.store` in store
 * order, each once, as `resolveSelection` gives them. Errors name the fields of the input under
 * `sort`.
 */
export const sortElements = (
  context: SortContext,
  elements: readonly ElementRecord[],
  keys: readonly FilterSortKeyWithDefaults[],
): SortedElements => {
  if (keys.length === 0) {
    return { elements };
  }
  keys.forEach((key, index) => {
    if (key.by !== "hierarchy") {
      return;
    }
    if (index > 0) {
      throw invalidAt(
        context,
        `sort[${String(index)}].by`,
        "hierarchy can only be the first sort key; the keys after it order the elements below each parent",
      );
    }
    if (key.order === "desc") {
      throw invalidAt(
        context,
        "sort[0].order",
        "hierarchy sorts ascending only; order the elements below each parent with the keys after it",
      );
    }
  });
  const columns = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => key.by !== "hierarchy")
    .map(({ key, index }) => ({
      column: columnOf(context, key.by, `sort[${String(index)}].by`),
      sign: key.order === "desc" ? -1 : 1,
    }))
    .reverse();
  // The cells of an element, linked from the first key on (built from the last).
  const cellsOf = (element: ElementRecord): Cell | undefined => {
    let first: Cell | undefined;
    for (const { column, sign } of columns) {
      first = column(element, sign, first);
    }
    return first;
  };
  // Only the first key can be `hierarchy` (above).
  if (keys.some((key) => key.by === "hierarchy")) {
    const { rows, at } = treeRowsOf(context, elements, cellsOf);
    rows.sort(compareRows);
    const tree = treeOf(rows, at);
    return { elements: tree.map((place) => place.element), tree };
  }
  const rows: Row[] = elements.map((element, position) => ({ element, position, first: cellsOf(element) }));
  rows.sort(compareRows);
  return { elements: rows.map((row) => row.element) };
};
