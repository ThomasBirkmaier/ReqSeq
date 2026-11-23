// The display model of the hint list (ADR-0019 point 4): the output of `hint.list` as one group per kind,
// headed by the title of the kind from schemas/problem-codes.yaml (SR-224 AK6, D-078: titles are kept once),
// in the order of `kinds` with the count core gives for it (SR-026), and under it one row per hint of the
// page in the order of the output, with its element, a short reason built from the hint's own fields and the
// element the row leads to. Pure, and it imports only types and import-free modules, so the pages of the web
// UI can import it (`@reqseq/core/displays`).
import type { HintListOutput } from "../generated/types.js";
import { shownId, shownIdTitle } from "../graph/words.js";
import { problemTitle } from "../problem-titles.js";
import type { ElementTarget } from "./element-ref.js";

type Hint = HintListOutput["hints"][number];

/** One hint as a row: its element, the reason (with the target where the hint has one) and the full message. */
export interface HintRowDisplay {
  /** The hint as the output gives it, for the values a side shows of it on request. */
  readonly hint: Hint;
  /** The element's short ID with its identifier, "SR-3c90b0 (SR-036)"; else its identifier, UUID or file. */
  readonly element: string;
  /** The element's title; empty when it has none. */
  readonly title: string;
  /** The element by its shown ID and title, "SR-3c90b0 (SR-036) Compute the coverage". */
  readonly name: string;
  readonly reason: string;
  readonly message: string;
  /** The element the row leads to; undefined when the hint names none. */
  readonly target: ElementTarget | undefined;
}

/** The hints of one kind: its code, the title of the kind, the count of all its hints and the rows of the page. */
export interface HintGroupDisplay {
  readonly code: string;
  /** The title of the kind (`problemTitle`); its code for a kind that has none. */
  readonly title: string;
  readonly count: number;
  readonly rows: readonly HintRowDisplay[];
}

/** The list: the count of all hints that pass the filters, the hints on the page, and the groups. */
export interface HintListDisplay {
  readonly total: number;
  readonly listed: number;
  readonly incomplete: boolean;
  readonly groups: readonly HintGroupDisplay[];
}

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
 * The reason of a hint from the output's fields (SR-026): of a count its relation kind or property, the
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

/** The row of a hint; it leads to its element when the hint names one. */
const hintRow = (hint: Hint, views: ReadonlyMap<string, string>): HintRowDisplay => {
  const id = hint.elementId;
  const element =
    hint.elementShortId === undefined
      ? (hint.elementIdentifier ?? id ?? hint.file ?? "")
      : shownId(hint.elementShortId, hint.elementIdentifier);
  const title = hint.elementTitle ?? "";
  // As a problem line: `elementRepository` is given only when `repository` names another file than the
  // element's (schemas/common.schema.json, `problem`).
  const repository = hint.elementRepository ?? hint.repository;
  return {
    hint,
    element,
    title,
    name:
      hint.elementShortId === undefined
        ? element
        : shownIdTitle(hint.elementShortId, hint.elementIdentifier, title),
    reason: hintReason(hint, views),
    message: hint.message,
    target: id === undefined || repository === undefined ? undefined : { id, repository },
  };
};

/**
 * The display model of `output`: a group per entry of `kinds` (which names the kind of every hint of every
 * page), in its order, with its count and the title of its kind, and the hints of the page under their kind
 * in the order of the output. `views` names the variants an outdated evidence record names by its UUID.
 */
export const hintListDisplay = (
  output: Pick<HintListOutput, "hints" | "kinds" | "total" | "incomplete">,
  views: ReadonlyMap<string, string>,
): HintListDisplay => {
  const rows = new Map<string, HintRowDisplay[]>();
  for (const hint of output.hints) {
    const group = rows.get(hint.code) ?? [];
    group.push(hintRow(hint, views));
    rows.set(hint.code, group);
  }
  return {
    total: output.total,
    listed: output.hints.length,
    incomplete: output.incomplete,
    groups: output.kinds.map((kind) => ({
      code: kind.code,
      title: problemTitle(kind.code) ?? kind.code,
      count: kind.count,
      rows: rows.get(kind.code) ?? [],
    })),
  };
};
