// For tests only: hint.list gives its hints with the titles of their element and target (SR-026 AK6),
// which workspace.check and element.get leave out (SR-020 AK1); without them the hints are equal.
import type { Problem } from "../catalog.js";

/** `problems` without `elementTitle` and `targetTitle`. */
export const withoutTitles = (problems: readonly Problem[]): Problem[] =>
  problems.map(({ elementTitle, targetTitle, ...rest }) => rest);
