// The hint list of the app (SR-026 AK4, AK5): the display model of `hint.list` ("List hints") that core builds
// (`hintListDisplay` of `@reqseq/core/displays`, ADR-0019): one foldable group per kind, headed by the title of
// the kind, in the order of `kinds` with the count core gives for it, so a group says how many hints it has
// also while the page shows only some of them; under it one row per hint of the page, in the order of the
// output, with the element (short ID, identifier, title) and a short reason, which names the target where the
// hint has one. The full message is the row's tooltip and goes to the modeline for the marked row. Core decides
// which hints there are, what they say and how they are grouped and worded (ADR-0002, SR-080); this file adds
// the buffer a row opens, the technical values "Show details" shows and the folding.
import type { HintListOutput } from "@reqseq/core";
import type { HintGroupDisplay } from "@reqseq/core/displays";
import { hintListDisplay } from "@reqseq/core/displays";
import type { ElementBuffer } from "./buffers.js";
import { elementBuffer } from "./buffers.js";
import { togglesFold } from "./FoldSection.js";
import type { DetailValue, OutputField } from "./result.js";
import { technicalValues } from "./result.js";

/** One hint as a row: its element, the reason (with the target where the hint has one) and the full message. */
export interface HintLine {
  /** The element's short ID with its identifier, "SR-3c90b0 (SR-036)". */
  readonly element: string;
  /** The element's title; empty when it has none. */
  readonly title: string;
  readonly reason: string;
  readonly message: string;
  /** The element the row opens; undefined when the hint names none. */
  readonly open: ElementBuffer | undefined;
  /**
   * The technical values of the hint under their titles, such as the UUID of its element, which the row shows
   * with "Show details" (SR-223 AK2); its kind is in the heading of its group.
   */
  readonly details: readonly DetailValue[];
}

/** The hints of one kind: its code, the title of the kind, the count of all its hints and the rows of the page. */
export interface HintGroup extends Omit<HintGroupDisplay, "rows"> {
  readonly lines: readonly HintLine[];
}

/** The list: the count of all hints that pass the filters, the hints on the page, and the groups. */
export interface HintList {
  readonly total: number;
  readonly listed: number;
  readonly incomplete: boolean;
  readonly groups: readonly HintGroup[];
}

/**
 * The list of `output` as core's display model gives it, each row with the buffer of its element and the
 * technical values `fields` (`outputFields`) mark.
 */
export const hintList = (
  output: HintListOutput,
  views: ReadonlyMap<string, string>,
  fields: readonly OutputField[] = [],
): HintList => {
  const { groups, ...counts } = hintListDisplay(output, views);
  return {
    ...counts,
    groups: groups.map(({ rows, ...group }) => ({
      ...group,
      lines: rows.map(({ hint, target, name, element, title, reason, message }) => ({
        element,
        title,
        reason,
        message,
        open: target === undefined ? undefined : elementBuffer(target.id, target.repository, name),
        details: technicalValues(hint, "hints[]", fields, ["code"]),
      })),
    })),
  };
};

/** The views the hints of `output` name that are variants: their UUIDs, for the app to name them. */
export const variantViews = (output: HintListOutput): string[] => [
  ...new Set(
    output.hints.flatMap((hint) => (hint.view === undefined || hint.view === "core" ? [] : [hint.view])),
  ),
];

/** Whether an output is that of `hint.list`: hints, the counts per kind and a total. */
export const isHintOutput = (output: unknown): output is HintListOutput =>
  typeof output === "object" &&
  output !== null &&
  Array.isArray((output as { hints?: unknown }).hints) &&
  Array.isArray((output as { kinds?: unknown }).kinds) &&
  typeof (output as { total?: unknown }).total === "number";

/** A row of the shown list: the heading of a group, or a hint under an open heading. */
export type HintRow =
  | { readonly kind: "head"; readonly group: HintGroup; readonly open: boolean }
  | { readonly kind: "hint"; readonly group: HintGroup; readonly line: HintLine };

/** The rows: each group's heading, and its hints while it is not folded. */
export const hintRows = (list: HintList, folded: ReadonlySet<string>): HintRow[] =>
  list.groups.flatMap((group): HintRow[] => {
    const open = !folded.has(group.code);
    return [
      { kind: "head", group, open },
      ...(open ? group.lines.map((line): HintRow => ({ kind: "hint", group, line })) : []),
    ];
  });

/** What a fold key does: the group it opens or closes, and the row marked after it. */
export interface FoldMove {
  readonly code: string;
  readonly open: boolean;
  readonly cursor: number;
}

/**
 * The fold a key does on the row at `cursor`: on a heading, the keys of every fold head (`togglesFold`:
 * Enter, Space and Tab, SR-193 AK1 for Tab) toggle it, and Right opens and Left closes it (SR-193 AK2); on
 * a hint, Left closes its group and marks its heading, as Left on a folded row of a list closes its section.
 * Undefined for any other key, a key with a modifier, or no row.
 */
export const foldMove = (
  rows: readonly HintRow[],
  cursor: number,
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): FoldMove | undefined => {
  const row = rows[cursor];
  if (row === undefined || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return undefined;
  }
  if (row.kind === "head") {
    if (togglesFold(event)) {
      return { code: row.group.code, open: !row.open, cursor };
    }
    const keys: Readonly<Record<string, boolean | undefined>> = { ArrowRight: true, ArrowLeft: false };
    const open = keys[event.key];
    return open === undefined ? undefined : { code: row.group.code, open, cursor };
  }
  if (event.key !== "ArrowLeft") {
    return undefined;
  }
  const head = rows.findIndex((each) => each.kind === "head" && each.group.code === row.group.code);
  return { code: row.group.code, open: false, cursor: head };
};
