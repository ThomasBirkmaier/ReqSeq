// The problems of one element as the web UI's element page lists them (#2234): every problem `element.get` gives in
// `element.problems`, errors first, then warnings, then info, one group per severity and kind, headed by the title
// of the kind from schemas/problem-codes.yaml (SR-224 AK6, as ADR-0019 point 4 heads hint groups). Within a
// severity the groups stand in the order their first problem has in the output, and a group keeps the output's
// order. A display shows a group of one problem as that problem, and may fold a larger one into one row. Pure, and
// it imports only types and import-free modules, so the web UI can import it (`@reqseq/core/displays`).
import type { Problem } from "../generated/types.js";
import { problemTitle } from "../problem-titles.js";

/** The problems of one severity and kind. */
export interface ProblemGroupDisplay {
  readonly severity: Problem["severity"];
  readonly code: string;
  /** The title of the kind (`problemTitle`); its code for a kind that has none. */
  readonly title: string;
  readonly problems: readonly Problem[];
}

/** The severities, the most severe first. */
const SEVERITIES: readonly Problem["severity"][] = ["error", "warning", "info"];

/** The problems of an element by severity and kind (see the file comment); none for an element without one. */
export const elementProblemGroups = (problems: readonly Problem[] | undefined): ProblemGroupDisplay[] =>
  SEVERITIES.flatMap((severity) => {
    const groups = new Map<string, Problem[]>();
    for (const problem of problems ?? []) {
      if (problem.severity === severity) {
        groups.set(problem.code, [...(groups.get(problem.code) ?? []), problem]);
      }
    }
    return [...groups].map(([code, grouped]) => ({
      severity,
      code,
      title: problemTitle(code) ?? code,
      problems: grouped,
    }));
  });
