// Since #1921, a full workspace.check reports the gaps of verification at the workspace file (SR-230 AK1,
// AK2): a warning when the workspace file names no evidence location while a requirement exists, else one
// info with the number of requirements with method test whose verification status is open in the core, whose
// `element.list` call is the check's `next` (#2189). Since #2536 it also warns, at the metamodel file, about a
// requirement type with elements and without a property with the meaning acceptance-criteria (SR-230 AK5).
// Most fixtures have requirements, no evidence location and no such property, so the tests about other
// findings leave these apart, as `withoutNoParent` does for the hints of SR-022 AK6.
import type { ProblemLike } from "./no-parent.js";

/** The problem codes of the gaps of verification (SR-230 AK1, AK2, AK5). */
export const VERIFICATION_GAP_CODES: readonly string[] = [
  "evidence.no-location",
  "evidence.open-requirements",
  "evidence.no-criteria-property",
];

/** `problems` without the gaps of verification. */
export const withoutVerificationGaps = <P extends ProblemLike>(problems: readonly P[]): P[] =>
  problems.filter((p) => !VERIFICATION_GAP_CODES.includes(p.code));
