// The codes of the hints that mark an outdated relation (core, SR-080): an outdated relation or inline
// reference (`relation.outdated`, SR-025) and a changed core requirement at the `replaces` item of its
// replacement (`variant.core-changed`, SR-045). Display only: core decides which code a hint has.

/** The codes of the hints on a changed version that the app marks and counts as outdated. */
export const OUTDATED_CODES: ReadonlySet<string> = new Set(["relation.outdated", "variant.core-changed"]);

/**
 * The word at an outdated relation or reference (SR-107 AK4, SR-110 AK2). It stands next to the element at
 * the other end of the link, so it names the link: "outdated" alone read as if that element were (#513).
 */
export const OUTDATED_WORD = "link outdated";

/** Whether a hint with `code` marks an outdated relation. */
export const isOutdatedCode = (code: string): boolean => OUTDATED_CODES.has(code);
