// The rows of the list and the search buffers, as `element.list` and `element.search` give them, and
// how many rows to ask for.
import type { ElementListOutput, ElementSearchOutput } from "@reqseq/core";
import { elementBufferOf } from "./buffers.js";
import type { ElementBuffer } from "./buffers.js";
import { shownId, shownIdTitle } from "./id-title.js";

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
  /** ID shown muted at the left: the short ID with the identifier in brackets (SR-084 AK4). */
  readonly label: string;
  /** The short ID, for a reference into another repository (D-058). */
  readonly shortId: string;
  /** The identifier, for `rowName`. */
  readonly identifier?: string | undefined;
  readonly title: string;
  readonly status: string | undefined;
  /** 0 for a root; a list that is not a tree has 0 everywhere. */
  readonly depth: number;
  /** Words of the hit to mark, lower case; none for a list. */
  readonly terms: readonly string[];
  /** The ID matched: mark it. */
  readonly markLabel: boolean;
  /** The matched words in the title, as core gives them (`titleMarks`, SR-174 AK4); none for a list. */
  readonly titleMarks: readonly Range[];
  /** Where a search hit was found and one line around it (SR-174); none for a list or a hit without one. */
  readonly snippet?: Snippet;
}

/** A marked part of a text: UTF-16 code-unit offsets, `end` exclusive. */
export type Range = readonly [number, number];

export interface Snippet {
  /** Where it was found: `text`, or the name of the property. */
  readonly where: string;
  readonly text: string;
  readonly marks: readonly Range[];
}

type Hit = ElementSearchOutput["hits"][number];

const ranges = (marks: readonly { readonly start: number; readonly end: number }[] | undefined): Range[] =>
  (marks ?? []).map(({ start, end }) => [start, end]);

/** The snippet of a hit as the row shows it: the field named as the CLI names it. */
const snippetOf = (snippet: NonNullable<Hit["snippet"]>): Snippet => ({
  where: snippet.field === "text" ? "text" : snippet.propertyName,
  text: snippet.text,
  marks: ranges(snippet.marks),
});

export const rowOf = (
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
  found: Pick<Row, "titleMarks" | "snippet"> = { titleMarks: [] },
): Row => {
  const label = shownId(element.shortId, element.identifier);
  return {
    open: elementBufferOf(element),
    label,
    shortId: element.shortId,
    identifier: element.identifier,
    title: element.title,
    status: element.status,
    depth,
    terms,
    markLabel,
    titleMarks: found.titleMarks,
    ...(found.snippet === undefined ? {} : { snippet: found.snippet }),
  };
};

/** The rows of a list the app asks for without `fields`, so the core gives every field in `elements` (#982). */
export const listRows = (output: ElementListOutput): Row[] =>
  (output.elements ?? []).map((element, at) => rowOf(element, output.tree?.[at]?.depth ?? 0, [], false));

export const searchRows = (output: ElementSearchOutput): Row[] =>
  output.hits.map((hit) =>
    rowOf(hit, 0, hit.terms, hit.fields.includes("id"), {
      titleMarks: ranges(hit.titleMarks),
      ...(hit.snippet === undefined ? {} : { snippet: snippetOf(hit.snippet) }),
    }),
  );

/**
 * The id of the selected row for `aria-activedescendant` (`<prefix>-<cursor>`); none while no row is
 * selected or there are no rows.
 */
export const activeRow = (prefix: string, cursor: number, length: number): string | undefined =>
  cursor < 0 || length === 0 ? undefined : `${prefix}-${String(cursor)}`;

/**
 * How many rows the first request of a list or search buffer asks for: whole pages, enough for the
 * selected row, so a buffer that is shown again is as long as it was; one page while no row is selected.
 */
export const firstLimit = (cursor: number, page: number, max: number): number =>
  Math.min(max, (Math.floor(Math.max(0, cursor) / page) + 1) * page);

/** A row as the prompt names it: the shown ID, then the title unless it is the identifier's text (#545). */
export const rowName = (row: Pick<Row, "shortId" | "identifier" | "title">): string =>
  shownIdTitle(row.shortId, row.identifier, row.title);

/**
 * Where the ID that matched stands in the row's label (SR-183 AK3): the identifier when a word of the query
 * is in it, else the short ID; no mark when the ID did not match. Core says only that the ID matched
 * (`fields` has "id"), not which, so the words of the query tell.
 */
export const labelMarks = (
  row: Pick<Row, "shortId" | "identifier" | "markLabel">,
  query: string,
): Range[] => {
  if (!row.markLabel) {
    return [];
  }
  const identifier = row.identifier?.trim() ?? "";
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  const inIdentifier = identifier !== "" && words.some((word) => identifier.toLowerCase().includes(word));
  // The label is `<short ID> (<identifier>)` (`shownId`): the identifier starts after the bracket.
  return [
    inIdentifier
      ? [row.shortId.length + 2, row.shortId.length + 2 + identifier.length]
      : [0, row.shortId.length],
  ];
};
