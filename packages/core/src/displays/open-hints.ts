// The open hints of one element (SR-026, SR-114 AK2, SR-232 AK4; ADR-0019 point 9(c)): the set and order `hint.list`
// gives for it, taken from the problems of `element.get` by the rule of `hint.list` (`hint-order.ts`), so the
// app's status line counts what the export's page lists without one more command call. Assumption of spec question
// #2231: a warning `element.get` adds that `hint.list` does not list (`file.faulty` without a version,
// `metamodel.meaning-unassigned`) stays in `problems` and counts as no hint. This module is the one place of that rule.
import { inCheckOrder, isHint } from "../hint-order.js";

/** What the rule reads of a problem. */
export interface HintLike {
  readonly code: string;
  readonly severity: string;
  readonly elementId?: string | undefined;
}

/** The open hints among the problems of one element, in the order of `hint.list` (see the file comment). */
export const openHints = <P extends HintLike>(problems: readonly P[] | undefined): P[] =>
  inCheckOrder((problems ?? []).filter((problem) => isHint(problem)));

/** The codes of the hints that mark an outdated relation (SR-025, SR-045): counted apart in the status line (SR-114 AK2). */
export const OUTDATED_HINT_CODES: ReadonlySet<string> = new Set([
  "relation.outdated",
  "variant.core-changed",
]);

/** How many of `hints` mark an outdated relation, reference or replacement, and how many are others (SR-114 AK2). */
export const hintCounts = (
  hints: readonly { readonly code: string }[],
): { readonly outdated: number; readonly other: number } => {
  const outdated = hints.filter((hint) => OUTDATED_HINT_CODES.has(hint.code)).length;
  return { outdated, other: hints.length - outdated };
};
