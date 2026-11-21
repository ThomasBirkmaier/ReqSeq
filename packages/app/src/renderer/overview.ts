// The rows of the overview (SR-118): one line per element type with the number of its elements, then the
// perspectives with the number of elements each lists, then the elements opened last; in a workspace in which
// `element.facets` counts no element, core's first steps (`FIRST_STEPS`, AK9) and below them only the
// perspectives. Pure: the counts come from `element.facets` and `element.list` with the perspective, the
// perspectives from `perspective.list`, the recent elements from `element.get`, the first steps from core;
// this module only orders them and says what a row opens (ADR-0002).
import type { CommandListing } from "../shared/protocol.js";
import type { Buffer, ElementBuffer, ListedPerspective } from "./buffers.js";
import { filteredList } from "./buffers.js";
import type { Answer } from "./call.js";
import { exactTypeStep } from "./list-filters.js";
import type { NextStep, StepEntry } from "./next-steps.js";
import { stepEntry, stepItemId } from "./next-steps.js";
import { inOrderOfUse } from "./perspective-recent.js";
import { RECENT_SHOWN } from "./recent.js";

/** A type of the workspace and its number of elements (`element.facets`, `types`). */
export interface TypeCount {
  readonly key: string;
  readonly name: string;
  readonly count: number;
}

/** The most perspectives the overview shows (SR-118 AK6). */
export const PERSPECTIVES_SHOWN = 10;

/**
 * What the line of a perspective shows after its name: nothing while its count is not computed (AK8), the
 * number of elements of its selection in the window's view (AK6), or a short reason why it cannot be listed
 * with core's message in full.
 */
export type PerspectiveCount =
  { readonly count: number } | { readonly reason: string; readonly message: string };

/** A perspective on the overview: its name and, once computed, its count. */
export interface PerspectiveRow {
  readonly name: string;
  readonly counted?: PerspectiveCount;
}

/** An element opened last, as the overview shows it. */
export interface RecentRow {
  readonly buffer: ElementBuffer;
  /** The short ID with the identifier in brackets (SR-084 AK4). */
  readonly label: string;
  readonly title: string;
}

/** A first step of a workspace without elements (AK9): the step and how the command prompt names its command. */
export interface StepRow extends StepEntry {
  readonly step: NextStep;
}

export type OverviewRow =
  | ({ readonly kind: "step" } & StepRow)
  | ({ readonly kind: "type" } & TypeCount)
  | ({ readonly kind: "perspective" } & PerspectiveRow)
  | ({ readonly kind: "recent" } & RecentRow);

/**
 * The names of the perspectives the overview shows (SR-118 AK6): at most `PERSPECTIVES_SHOWN`, by name
 * ignoring case (the order of the prompt of "Open perspective" without any perspective opened, SR-214 AK1).
 */
export const shownPerspectives = (listed: readonly ListedPerspective[]): readonly string[] =>
  inOrderOfUse(listed, [])
    .slice(0, PERSPECTIVES_SHOWN)
    .map((perspective) => perspective.name);

/**
 * The count of a perspective from `element.list` with it: the `total` of its selection, each element once,
 * the statuses folded in lists too (SR-201). An error gives "faulty file" when core names a faulty file of
 * the perspective or its saved filter (`file.faulty`), else "cannot be listed"; the message says why.
 */
export const perspectiveCount = (answer: Answer<"element.list">): PerspectiveCount =>
  answer.ok
    ? { count: answer.output.total }
    : { reason: answer.code === "file.faulty" ? "faulty file" : "cannot be listed", message: answer.message };

/** The type lines in the order given, then the perspectives, then at most `RECENT_SHOWN` recent elements, newest first. */
export const overviewRows = (
  types: readonly TypeCount[],
  perspectives: readonly PerspectiveRow[],
  recents: readonly RecentRow[],
): readonly OverviewRow[] => [
  ...types.map((type): OverviewRow => ({ kind: "type", ...type })),
  ...perspectives.map((perspective): OverviewRow => ({ kind: "perspective", ...perspective })),
  ...recents.slice(0, RECENT_SHOWN).map((recent): OverviewRow => ({ kind: "recent", ...recent })),
];

/**
 * The lines of the first steps (AK9): each step that an entry of the command prompt runs in the shown view
 * (`items`), by the name and key the prompt gives its command; a step whose command is not executable there
 * (SR-133 AK1) has no line.
 */
export const stepRows = (
  steps: readonly NextStep[],
  catalog: readonly CommandListing[],
  items: readonly { readonly id: string }[],
  mac: boolean,
): readonly StepRow[] => {
  const runs = new Set(items.map((item) => item.id));
  return steps
    .filter((step) => runs.has(stepItemId(step, catalog)))
    .map((step) => ({ step, ...stepEntry(step.command, catalog, mac) }));
};

/** The rows of a workspace in which the tool counts no element (AK9): the first steps, then only the perspectives. */
export const firstStepRows = (
  steps: readonly StepRow[],
  perspectives: readonly PerspectiveRow[],
): readonly OverviewRow[] => [
  ...steps.map((step): OverviewRow => ({ kind: "step", ...step })),
  ...perspectives.map((perspective): OverviewRow => ({ kind: "perspective", ...perspective })),
];

/** The text of a type line: "System Requirement 117". */
export const typeLine = (row: TypeCount): string => `${row.name} ${String(row.count)}`;

/** The text of a perspective line: "Drafts 12", "Drafts faulty file", or only the name while it is counted. */
export const perspectiveLine = (row: PerspectiveRow): string => {
  const { counted } = row;
  if (counted === undefined) {
    return row.name;
  }
  return `${row.name} ${"count" in counted ? String(counted.count) : counted.reason}`;
};

/**
 * What a type or recent row opens: a type line the list of the elements of exactly that type (the same
 * selection the count is of, so the list is as long as the count says; it filters further like any list,
 * SR-124); a recent element its buffer. A perspective opens through `openPerspective` (SR-118 AK7).
 */
export const openRow = (row: Extract<OverviewRow, { readonly kind: "type" | "recent" }>): Buffer =>
  row.kind === "type" ? filteredList([exactTypeStep(row.key, row.name)]) : row.buffer;
