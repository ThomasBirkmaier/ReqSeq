// The verification status of an element in one view as every display words it (ADR-0019 point 4): the status, and
// for a requirement whose status comes from its own records the acceptance criteria they verify (SR-031 AK5). One
// long form for a page or a line, one short form for a cell or a badge; the app, the HTML export and the CLI's text
// output all take their words from `verificationLabel`.
import type { DataExportVerificationEntry } from "../generated/types.js";
import { criterionLabel } from "../model/criterion-items.js";

/** The verification status of an element in one view, as `element.get` and `element.list` give it. */
export type VerificationCell = Pick<
  DataExportVerificationEntry,
  "view" | "status" | "criteria" | "missingChildren"
>;

/** Which form of the words: `long` on a page or a line, `short` in a cell or a badge. */
export type LabelForm = "long" | "short";

/**
 * The words of `cell`: long "open, 2 of 3 criteria, AK3 (k7f3) not verified", short "open · 2 of 3"; the status
 * alone without counted criteria. The missing children of an open requirement (SR-034 AK2) are not part of it:
 * each display names them as links of its own.
 */
export const verificationLabel = (
  cell: { readonly status: string; readonly criteria?: VerificationCell["criteria"] },
  form: LabelForm,
): string => {
  const { status, criteria } = cell;
  if (criteria === undefined) {
    return status;
  }
  const count = `${String(criteria.verified)} of ${String(criteria.total)}`;
  if (form === "short") {
    return `${status} · ${count}`;
  }
  const open = (criteria.notVerified ?? []).map(criterionLabel);
  return `${status}, ${count} criteria${open.length === 0 ? "" : `, ${open.join(", ")} not verified`}`;
};
