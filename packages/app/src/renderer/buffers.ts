// The buffers of the main view (D-062): the window shows one buffer at a time, the most recent one.
// A buffer is a list, a search result or an element. This module is the model and the reducer, no React.
import type { ElementSelection, FilterSortKeyWithDefaults } from "@logreq/core";

/** The list of elements of the workspace: one buffer, changed in place when filtered or sorted. */
export interface ListBuffer {
  readonly kind: "list";
  readonly key: string;
  /** What the list holds: "All elements", "type: need", "status: draft", "filter: <name>". */
  readonly label: string;
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

export const listBuffer = (
  label: string,
  selection?: ElementSelection,
  sort?: readonly FilterSortKeyWithDefaults[],
): ListBuffer => ({
  kind: "list",
  key: LIST_KEY,
  label,
  cursor: 0,
  ...(selection === undefined ? {} : { selection }),
  ...(sort === undefined ? {} : { sort }),
});

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
