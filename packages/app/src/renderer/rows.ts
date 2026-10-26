// The rows of the list and the search buffers, as `element.list` and `element.search` give them, and
// how many rows to ask for.
import type { ElementListOutput, ElementSearchOutput } from "@logreq/core";
import { elementBufferOf } from "./buffers.js";
import type { ElementBuffer } from "./buffers.js";

/** Rows of a list page (the command's default); the next page is asked for when the end is reached. */
export const LIST_PAGE = 200;
/** Hits of a search page. */
export const SEARCH_PAGE = 50;
/** The most `element.list` and `element.search` give at once. */
export const LIST_MAX = 5000;
export const SEARCH_MAX = 500;

export interface Row {
  /** The element: for opening its buffer. */
  readonly open: ElementBuffer;
  /** ID shown muted at the left: the identifier, else the short ID. */
  readonly label: string;
  /** The short ID, for a reference into another repository (D-058). */
  readonly shortId: string;
  readonly title: string;
  readonly status: string | undefined;
  /** 0 for a root; a list that is not a tree has 0 everywhere. */
  readonly depth: number;
  /** Words of the hit to mark, lower case; none for a list. */
  readonly terms: readonly string[];
  /** The ID matched: mark it. */
  readonly markLabel: boolean;
}

const rowOf = (
  element: {
    readonly id: string;
    readonly repository: string;
    readonly shortId: string;
    readonly identifier?: string | undefined;
    readonly title: string;
    readonly status?: string | undefined;
  },
  depth: number,
  terms: readonly string[],
  markLabel: boolean,
): Row => {
  const label = element.identifier ?? element.shortId;
  return {
    open: elementBufferOf(element),
    label,
    shortId: element.shortId,
    title: element.title,
    status: element.status,
    depth,
    terms,
    markLabel,
  };
};

export const listRows = (output: ElementListOutput): Row[] =>
  output.elements.map((element, at) => rowOf(element, output.tree?.[at]?.depth ?? 0, [], false));

export const searchRows = (output: ElementSearchOutput): Row[] =>
  output.hits.map((hit) => rowOf(hit, 0, hit.terms, hit.fields.includes("id")));

/**
 * How many rows the first request of a list or search buffer asks for: whole pages, enough for the
 * selected row, so a buffer that is shown again is as long as it was.
 */
export const firstLimit = (cursor: number, page: number, max: number): number =>
  Math.min(max, (Math.floor(cursor / page) + 1) * page);
