// The buffers of the main view (D-062): the window shows one buffer at a time, the most recent one.
// A buffer is a list, a search result or an element. This module is the model and the reducer, no React.
import type { DataExportRelation, ElementSelection, FilterSortKeyWithDefaults } from "@logreq/core";
import { hasSavedFilter } from "./list-filters.js";

/** One step of a list filter: the text the label shows and what it adds to the selection (a condition or a saved filter). */
export interface FilterStep {
  readonly label: string;
  readonly selection: Pick<ElementSelection, "where" | "filter">;
}

/** The list of elements of the workspace: one buffer, changed in place when filtered or sorted. */
export interface ListBuffer {
  readonly kind: "list";
  readonly key: string;
  /** What the list holds: "All elements", or the labels of the steps joined by " · " ("type: need · status: draft"). */
  readonly label: string;
  /** The filter steps, each narrowing the list of the one before (SR-124 AK1); none: every element. */
  readonly steps: readonly FilterStep[];
  /** What the steps select together, the input of `element.list` (`selectionOf`). */
  readonly selection?: ElementSelection;
  /**
   * How the list is sorted. Not set: nothing chosen yet, `listSort` tells what is asked for. `[]`: the
   * workspace order (the order of the store). Else the keys as `element.list` takes them.
   */
  readonly sort?: readonly FilterSortKeyWithDefaults[];
  /** Index of the selected row. */
  readonly cursor: number;
}

/** The hits of one search. */
export interface SearchBuffer {
  readonly kind: "search";
  readonly key: string;
  readonly query: string;
  readonly cursor: number;
}

/** One element, read-only. `repository` and `id` identify it: a UUID may exist in several repositories. */
export interface ElementBuffer {
  readonly kind: "element";
  readonly key: string;
  readonly id: string;
  readonly repository: string;
  /** "<identifier or short ID> <title>". */
  readonly name: string;
  /** A package page (SR-112): how its elements are sorted, kept while the buffer is open (as `ListBuffer.sort`). */
  readonly memberSort?: readonly FilterSortKeyWithDefaults[] | undefined;
  /** A package page: the selected row of its elements; set once the reader has used them. */
  readonly memberCursor?: number;
}

/** The calm start (SR-118): one line per element type with its count, then the elements opened last. */
export interface OverviewBuffer {
  readonly kind: "overview";
  readonly key: "overview";
  /** Index of the selected row. */
  readonly cursor: number;
}

/**
 * The neighbourhood of one element (SR-107): its parents, the tree of its children and its incoming
 * relations. `repository` and `id` identify the element as in `ElementBuffer`.
 */
export interface NeighbourhoodBuffer {
  readonly kind: "neighbourhood";
  readonly key: string;
  readonly id: string;
  readonly repository: string;
  /** "<identifier or short ID> <title>" of the element. */
  readonly name: string;
  /** The rows of the tree whose children are shown, as `<repository>:<id>`. */
  readonly open: readonly string[];
  /** Index of the selected row: first the rows of the tree, then those of the incoming groups. */
  readonly cursor: number;
}

export type Buffer = ListBuffer | SearchBuffer | ElementBuffer | OverviewBuffer | NeighbourhoodBuffer;

/** Open buffers, the most recent first; the first one is shown. */
export type Buffers = readonly Buffer[];

export type BufferAction =
  /** Shows `buffer`; one with the same key is replaced and moved to the front. */
  | { readonly type: "open"; readonly buffer: Buffer }
  /** Shows the open buffer with this key. */
  | { readonly type: "switch"; readonly key: string }
  /** Closes the buffer; the next most recent one is shown, or the overview when none is left. */
  | { readonly type: "close"; readonly key: string }
  /** The workspace was opened: only `buffer` is open, or none. */
  | { readonly type: "reset"; readonly buffer?: Buffer }
  /** The selected row of a list or search buffer, or of the elements of a package page. */
  | { readonly type: "cursor"; readonly key: string; readonly cursor: number };

/** The most buffers kept; the least recent one goes first. */
export const MAX_BUFFERS = 30;

export const LIST_KEY = "list";

export const OVERVIEW_KEY = "overview";

export const overviewBuffer = (): OverviewBuffer => ({ kind: "overview", key: OVERVIEW_KEY, cursor: 0 });

/** Exactly one buffer is open and it is the overview: there is nothing to close. */
export const onlyOverview = (buffers: Buffers): boolean =>
  buffers.length === 1 && buffers[0]?.kind === "overview";

const makeList = (
  label: string,
  steps: readonly FilterStep[],
  selection: ElementSelection | undefined,
  sort: readonly FilterSortKeyWithDefaults[] | undefined,
): ListBuffer => ({
  kind: "list",
  key: LIST_KEY,
  label,
  steps,
  cursor: 0,
  ...(selection === undefined ? {} : { selection }),
  ...(sort === undefined ? {} : { sort }),
});

/** A list with one step: the selection under its label (or every element, without a selection). */
export const listBuffer = (
  label: string,
  selection?: ElementSelection,
  sort?: readonly FilterSortKeyWithDefaults[],
): ListBuffer => makeList(label, selection === undefined ? [] : [{ label, selection }], selection, sort);

/**
 * What the steps select together (SR-124 AK1): the conditions of all steps in order, one alone as it
 * is, several as `all`, and the saved filter of the step that has one; undefined without steps. This
 * only builds the input of `element.list`; the core applies it (ADR-0002).
 */
export const selectionOf = (steps: readonly FilterStep[]): ElementSelection | undefined => {
  const conditions = steps.flatMap((step) =>
    step.selection.where === undefined ? [] : [step.selection.where],
  );
  const filter = steps.find((step) => step.selection.filter !== undefined)?.selection.filter;
  const [only] = conditions;
  const where = conditions.length > 1 ? { all: conditions } : only;
  const selection: ElementSelection = {
    ...(filter === undefined ? {} : { filter }),
    ...(where === undefined ? {} : { where }),
  };
  return Object.keys(selection).length === 0 ? undefined : selection;
};

/** The list the steps give: "All elements" without steps, else the step labels joined by " · ". */
export const filteredList = (
  steps: readonly FilterStep[],
  sort?: readonly FilterSortKeyWithDefaults[],
): ListBuffer =>
  makeList(
    steps.length === 0 ? "All elements" : steps.map((step) => step.label).join(" · "),
    steps,
    selectionOf(steps),
    sort,
  );

export const searchBuffer = (query: string): SearchBuffer => ({
  kind: "search",
  key: `search:${query}`,
  query,
  cursor: 0,
});

export const elementBuffer = (id: string, repository: string, name: string): ElementBuffer => ({
  kind: "element",
  key: `element:${repository}:${id}`,
  id,
  repository,
  name,
});

export const neighbourhoodBuffer = (id: string, repository: string, name: string): NeighbourhoodBuffer => ({
  kind: "neighbourhood",
  key: `neighbourhood:${repository}:${id}`,
  id,
  repository,
  name,
  open: [],
  cursor: 0,
});

/** The buffer of an element as a list row, a hit or a read element shows it. */
export const elementBufferOf = (element: {
  readonly id: string;
  readonly repository: string;
  readonly shortId: string;
  readonly identifier?: string | undefined;
  readonly title: string;
}): ElementBuffer =>
  elementBuffer(
    element.id,
    element.repository,
    `${element.identifier ?? element.shortId} ${element.title}`.trim(),
  );

/**
 * The buffer of the element a relation points at (#416): its UUID in the repository of the target, named as
 * the relation shows it; undefined when the relation names no repository (a stored `repository` that is
 * not text).
 */
export const relationBuffer = (
  relation: Pick<DataExportRelation, "id" | "repository" | "shortId" | "identifier" | "title">,
): ElementBuffer | undefined =>
  relation.repository === undefined
    ? undefined
    : elementBuffer(
        relation.id,
        relation.repository,
        `${relation.identifier ?? relation.shortId ?? relation.id} ${relation.title ?? ""}`.trim(),
      );

/**
 * The order the lists of the app start with (#418): by type in the order of the metamodel, then by the
 * identifier, digit runs as numbers (SR-9 before SR-10). The app chooses this input; `element.list`
 * without `sort` keeps the workspace order for every other access (ADR-0002, D-029). A frozen constant,
 * so the list does not ask again for another object with the same keys.
 */
export const DEFAULT_SORT: readonly FilterSortKeyWithDefaults[] = Object.freeze([
  Object.freeze({ by: "type", order: "asc" }),
  Object.freeze({ by: "identifier", order: "asc" }),
] as const);

/**
 * The `sort` a list asks `element.list` for: the one chosen; else, with a saved filter among the
 * steps, none, so the sort of the filter holds (SR-070 AK3); else `DEFAULT_SORT`.
 */
export const listSort = (buffer: ListBuffer): readonly FilterSortKeyWithDefaults[] | undefined =>
  buffer.sort ?? (hasSavedFilter(buffer.steps) ? undefined : DEFAULT_SORT);

const sameSort = (
  a: readonly FilterSortKeyWithDefaults[],
  b: readonly FilterSortKeyWithDefaults[],
): boolean =>
  a.length === b.length && a.every((key, index) => key.by === b[index]?.by && key.order === b[index].order);

const SORT_WORDS: Readonly<Record<string, string>> = {
  id: "ID",
  title: "title",
  identifier: "ID",
  type: "type",
  status: "status",
};

/**
 * " · tree", " · sorted by title" (descending: "... descending"), " · workspace order" for `[]`, and
 * nothing for the default (not chosen, or chosen as "Type and ID"): the default says nothing (D-062).
 */
export const sortLabel = (sort: readonly FilterSortKeyWithDefaults[] | undefined): string => {
  if (sort === undefined || sameSort(sort, DEFAULT_SORT)) {
    return "";
  }
  const first = sort[0];
  if (first === undefined) {
    return " · workspace order";
  }
  if (first.by === "hierarchy") {
    return " · tree";
  }
  return ` · sorted by ${SORT_WORDS[first.by] ?? first.by}${first.order === "desc" ? " descending" : ""}`;
};

/** The name of a buffer, as the minibuffer lists it and the sheet is labelled. */
export const bufferName = (buffer: Buffer): string => {
  switch (buffer.kind) {
    case "list":
      return `${buffer.label}${sortLabel(buffer.sort)}`;
    case "search":
      return `Search: ${buffer.query}`;
    case "element":
      return buffer.name;
    case "overview":
      return "Overview";
    case "neighbourhood":
      return `Neighbourhood: ${buffer.name}`;
  }
};

const front = (buffers: Buffers, key: string, replacement?: Buffer): Buffers => {
  const found = buffers.find((buffer) => buffer.key === key);
  if (found === undefined) {
    return buffers;
  }
  return [replacement ?? found, ...buffers.filter((buffer) => buffer.key !== key)];
};

export const reduceBuffers = (buffers: Buffers, action: BufferAction): Buffers => {
  switch (action.type) {
    case "open": {
      const moved = front(buffers, action.buffer.key, action.buffer);
      return (moved === buffers ? [action.buffer, ...buffers] : moved).slice(0, MAX_BUFFERS);
    }
    case "switch":
      return front(buffers, action.key);
    case "close": {
      const rest = buffers.filter((buffer) => buffer.key !== action.key);
      if (rest.length === buffers.length) {
        return buffers;
      }
      if (rest.length > 0) {
        return rest;
      }
      // The last buffer closed: the window shows the overview, never an empty sheet (SR-118). The lone
      // overview stays as it is.
      return onlyOverview(buffers) ? buffers : [overviewBuffer()];
    }
    case "reset":
      return action.buffer === undefined ? [] : [action.buffer];
    case "cursor":
      return buffers.map((buffer) => {
        if (buffer.key !== action.key) {
          return buffer;
        }
        return buffer.kind === "element"
          ? { ...buffer, memberCursor: action.cursor }
          : { ...buffer, cursor: action.cursor };
      });
  }
};
