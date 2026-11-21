// The open hints of one element on its page (SR-232 AK4: as `hint.list` gives them; ADR-0019 point 9(c)): the set and
// order `hint.list` gives for it, taken from the problems of `element.get` by the rule of `hint.list`
// (`hint-order.ts`), so a display that has only `element.get` lists what the export's page lists: every warning that
// names the element, the `file.faulty` warning without a version among them, and no warning that names none
// (`metamodel.meaning-unassigned`, #2231). This module is the one place of that rule.
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
