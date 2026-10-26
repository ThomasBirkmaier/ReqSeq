// The buffers of the main view (D-062): the window shows one buffer at a time, the most recent one.
// A buffer is a list, a search result or an element. This module is the model and the reducer, no React.
import type { DataExportRelation, ElementSelection, FilterSortKeyWithDefaults } from "@logreq/core";

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
}

export type Buffer = ListBuffer | SearchBuffer | ElementBuffer;

/** Open buffers, the most recent first; the first one is shown. */
export type Buffers = readonly Buffer[];

export type BufferAction =
  /** Shows `buffer`; one with the same key is replaced and moved to the front. */
  | { readonly type: "open"; readonly buffer: Buffer }
  /** Shows the open buffer with this key. */
  | { readonly type: "switch"; readonly key: string }
  /** Closes the buffer; the next most recent one is shown. */
  | { readonly type: "close"; readonly key: string }
  /** The workspace was opened: only `buffer` is open, or none. */
  | { readonly type: "reset"; readonly buffer?: Buffer }
  /** The selected row of a list or search buffer. */
  | { readonly type: "cursor"; readonly key: string; readonly cursor: number };

/** The most buffers kept; the least recent one goes first. */
export const MAX_BUFFERS = 30;

export const LIST_KEY = "list";

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

const SORT_WORDS: Readonly<Record<string, string>> = {
  id: "ID",
  title: "title",
  type: "type",
  status: "status",
};

/** " · tree", " · sorted by title" (descending: "... descending"), or nothing without a sort. */
export const sortLabel = (sort: readonly FilterSortKeyWithDefaults[] | undefined): string => {
  const first = sort?.[0];
  if (first === undefined) {
    return "";
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
    case "close":
      return buffers.filter((buffer) => buffer.key !== action.key);
    case "reset":
      return action.buffer === undefined ? [] : [action.buffer];
    case "cursor":
      return buffers.map((buffer) =>
        buffer.key === action.key && buffer.kind !== "element"
          ? { ...buffer, cursor: action.cursor }
          : buffer,
      );
  }
};
