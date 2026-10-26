// The rows of the overview (SR-118): one line per element type with the number of its elements, then the
// elements opened last. Pure: the counts come from `element.facets`, the recent elements from
// `element.get`; this module only orders them and says what a row opens (ADR-0002).
import type { Buffer, ElementBuffer } from "./buffers.js";
import { filteredList } from "./buffers.js";
import { exactTypeStep } from "./list-filters.js";
import { RECENT_SHOWN } from "./recent.js";

/** A type of the workspace and its number of elements (`element.facets`, `types`). */
export interface TypeCount {
  readonly key: string;
  readonly name: string;
  readonly count: number;
}

/** An element opened last, as the overview shows it. */
export interface RecentRow {
  readonly buffer: ElementBuffer;
  /** The identifier, else the short ID. */
  readonly label: string;
  readonly title: string;
}

export type OverviewRow = ({ readonly kind: "type" } & TypeCount) | ({ readonly kind: "recent" } & RecentRow);

/** The type lines in the order given, then at most `RECENT_SHOWN` recent elements, newest first. */
export const overviewRows = (
  types: readonly TypeCount[],
  recents: readonly RecentRow[],
): readonly OverviewRow[] => [
  ...types.map((type): OverviewRow => ({ kind: "type", ...type })),
  ...recents.slice(0, RECENT_SHOWN).map((recent): OverviewRow => ({ kind: "recent", ...recent })),
];

/** The text of a type line: "System Requirement 117". */
export const typeLine = (row: TypeCount): string => `${row.name} ${String(row.count)}`;

/**
 * What a row opens: a type line the list of the elements of exactly that type (the same selection the count
 * is of, so the list is as long as the count says; it filters further like any list, SR-124); a recent
 * element its buffer.
 */
export const openRow = (row: OverviewRow): Buffer =>
  row.kind === "type" ? filteredList([exactTypeStep(row.key)]) : row.buffer;
