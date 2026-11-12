// The hint list of the app (SR-026 AK4, AK5): the output of `hint.list` ("List hints") as one foldable group
// per kind, in the order of `kinds` (each kind's first hint over all pages) with the count core gives for it,
// so a group says how many hints it has also while the page shows only some of them; under it one row per
// hint of the page, in the order of the output, with the element (short ID, identifier, title) and a short
// reason built from the hint's own fields, which names the target where the hint has one. The full message is the
// row's tooltip and goes to the modeline for the marked row. Core decides which hints there are and what
// they say (ADR-0002, SR-080); this file only lays out its output.
import type { HintListOutput } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import { elementBuffer } from "./buffers.js";
import { togglesFold } from "./FoldSection.js";
import { shownId, shownIdTitle } from "./id-title.js";

type Hint = HintListOutput["hints"][number];

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
}

/** The hints of one kind: its code, its heading, the count of all its hints and the rows of the page. */
export interface HintGroup {
  readonly code: string;
  readonly label: string;
  readonly count: number;
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
 * How the app heads the group of a kind: every code the whole-workspace path of `hint.list` gives
 * (`CHECK_ORDER` in packages/core/src/hints/list.ts, which `hint-list.test.ts` compares); any other kind is
 * headed by its code.
 */
const LABELS: Readonly<Record<string, string>> = {
  "element.missing-required": "Missing required properties",
  "element.unknown-property": "Unknown properties",
  "element.unknown-type": "Unknown types",
  "element.missing-status": "Missing statuses",
  "element.status-not-allowed": "Statuses not allowed",
  "element.statement-without-text": "Requirements without text",
  "relation.target-superseded": "Superseded targets",
  "variant.superseded-in-validity": "Superseded variants in a validity",
  "variant.nested": "Nested variants",
  "variant.target-not-core": "Targets that are no core requirements",
  "element.wrong-value-kind": "Values of the wrong kind",
  "element.too-many-items": "Too many items",
  "element.criterion-key-missing": "Missing criterion keys",
  "element.criterion-key-invalid": "Invalid criterion keys",
  "element.criterion-key-duplicate": "Duplicate criterion keys",
  "relation.not-allowed": "Relations not allowed",
  "relation.too-few": "Too few relations",
  "relation.too-many": "Too many relations",
  "element.duplicate-identifier": "Duplicate identifiers",
  "relation.cross-repository-title": "Titles stored across repositories",
  "relation.not-a-link": "References outside a Markdown link",
  "relation.reference-style": "Reference-style Markdown links",
  "relation.unresolved-link": "Targets not named by a UUID",
  "trace.cycle": "Cycles of derivations",
  "trace.no-parent": "Without parent",
  "evidence.outdated": "Outdated evidence records",
  "variant.core-changed-since-baseline": "Core requirements changed since the baseline",
  "variant.core-new-since-baseline": "Core requirements new since the baseline",
  "relation.outdated": "Outdated relations",
  "variant.core-changed": "Changed core requirements",
};

/** The heading of a kind's group. */
export const kindLabel = (code: string): string => LABELS[code] ?? code;

/** How many characters of the message a row shows as its reason when the fields give no shorter one. */
export const MESSAGE_START = 80;

/** The start of a message: up to `MESSAGE_START` characters, cut with "…" when it is longer. */
export const messageStart = (message: string): string =>
  message.length <= MESSAGE_START ? message : `${message.slice(0, MESSAGE_START - 1).trimEnd()}…`;

/** The target of a hint, as the row names it; undefined when the hint has none. */
const targetOf = (hint: Hint): string | undefined => {
  if (hint.targetShortId !== undefined) {
    return shownIdTitle(hint.targetShortId, hint.targetIdentifier, hint.targetTitle);
  }
  return hint.targetIdentifier ?? hint.targetId;
};

/**
 * The reason of a hint from the output's fields (SR-026 AK4): of a count its relation kind or property, the
 * target type, the count and the limit; of outdated evidence the view (`core`, or the variant `views`
 * names); of a relation to a resolved target its kind and that target; else the start of the message,
 * after the relation kind and the target where the hint has them.
 */
export const hintReason = (hint: Hint, views: ReadonlyMap<string, string>): string => {
  if (hint.count !== undefined && hint.limit !== undefined) {
    const what = [hint.key, hint.targetType].filter((part) => part !== undefined).join(" → ");
    const bound = hint.code === "relation.too-few" ? "at least" : "at most";
    return `${what === "" ? "" : `${what} · `}${String(hint.count)} of ${bound} ${String(hint.limit)}`;
  }
  if (hint.view !== undefined) {
    return `view: ${hint.view === "core" ? "Core" : (views.get(hint.view) ?? hint.view)}`;
  }
  const target = targetOf(hint);
  // A relation to one element it resolved to: its kind and that target say it; an unresolved target keeps
  // the start of the message, which says what is wrong with it.
  if (hint.key !== undefined && hint.targetShortId !== undefined && target !== undefined) {
    return `${hint.key} → ${target}`;
  }
  if (target === undefined) {
    return messageStart(hint.message);
  }
  return `${hint.key ?? ""} → ${target} · ${messageStart(hint.message)}`.trimStart();
};

/** The row of a hint; it opens its element when the hint names one. */
const hintLine = (hint: Hint, views: ReadonlyMap<string, string>): HintLine => {
  const id = hint.elementId;
  const element =
    hint.elementShortId === undefined
      ? (hint.elementIdentifier ?? id ?? hint.file ?? "")
      : shownId(hint.elementShortId, hint.elementIdentifier);
  const title = hint.elementTitle ?? "";
  // As the problem line of the result buffer: `elementRepository` is given only when `repository` names
  // another file than the element's (schemas/common.schema.json, `problem`).
  const repository = hint.elementRepository ?? hint.repository;
  return {
    element,
    title,
    reason: hintReason(hint, views),
    message: hint.message,
    open:
      id === undefined || repository === undefined
        ? undefined
        : elementBuffer(
            id,
            repository,
            hint.elementShortId === undefined
              ? element
              : shownIdTitle(hint.elementShortId, hint.elementIdentifier, title),
          ),
  };
};

/**
 * The list of `output`: a group per entry of `kinds` (which names the kind of every hint of every page), in
 * its order and with its count, and the hints of the page under their kind in the order of the output.
 */
export const hintList = (output: HintListOutput, views: ReadonlyMap<string, string>): HintList => {
  const rows = new Map<string, HintLine[]>();
  for (const hint of output.hints) {
    const lines = rows.get(hint.code) ?? [];
    lines.push(hintLine(hint, views));
    rows.set(hint.code, lines);
  }
  return {
    total: output.total,
    listed: output.hints.length,
    incomplete: output.incomplete,
    groups: output.kinds.map((kind) => ({
      code: kind.code,
      label: kindLabel(kind.code),
      count: kind.count,
      lines: rows.get(kind.code) ?? [],
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
