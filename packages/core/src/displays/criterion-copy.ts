// The acceptance criteria as the element page copies them (#2256): each criterion's text after the reference a test
// name uses, as `element.get` gives it in `criterionReferences` (SR-205 AK1), `[SR-036/AK-k7f3] text`. A criterion
// without a reference (no key, a key two criteria share, or a requirement without references) is copied as its text.
import type { DataExportCriterionEntry } from "../generated/types.js";

/** What the copy buttons of the criteria put on the clipboard. */
export interface CriteriaCopy {
  /** The copy of each criterion, by position (criterion 1 first). */
  readonly rows: readonly string[];
  /** Every criterion, one after the other, each on a line of its own. */
  readonly all: string;
}

/**
 * The copies of the criteria whose texts are `texts`, in their order, with the references of `references` (the
 * entries of `element.get` `criterionReferences.criteria`), matched by number.
 */
export const criteriaCopy = (
  texts: readonly string[],
  references: readonly Pick<DataExportCriterionEntry, "criterion" | "reference">[] = [],
): CriteriaCopy => {
  const rows = texts.map((text, at) => {
    const reference = references.find((r) => r.criterion === at + 1)?.reference;
    return reference === undefined ? text : `${reference} ${text}`;
  });
  return { rows, all: rows.join("\n") };
};
