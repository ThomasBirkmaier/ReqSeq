// Since #659, every system requirement without a derivation is a `trace.no-parent` hint of
// workspace.check (SR-022 AK6). The generator gives some system requirements no `derives-from` or
// `refines` key and no invalid status, so the performance suite counts those hints apart from the
// findings it is about.

/** The problem code of the hint. */
export const NO_PARENT_CODE = "trace.no-parent";

/** The fields of a problem these helpers read (the testkit cannot import core's `Problem`). */
export interface ProblemLike {
  readonly code: string;
  readonly severity?: string;
  readonly elementId?: string;
}

/** How many generated system requirements in `files` got no derivation: one hint each. */
export const withoutParent = (files: ReadonlyMap<string, string>): number => {
  let count = 0;
  for (const content of files.values()) {
    if (/^type: system-requirement$/m.test(content) && !/^(derives-from|refines):/m.test(content)) {
      count += 1;
    }
  }
  return count;
};

/** The `trace.no-parent` hints of `problems`. */
export const noParentHints = <P extends ProblemLike>(problems: readonly P[]): P[] =>
  problems.filter((p) => p.code === NO_PARENT_CODE);

/** The `trace.no-parent` hints of `problems` that are not a warning about an element: none is expected. */
export const malformedNoParentHints = <P extends ProblemLike>(problems: readonly P[]): P[] =>
  noParentHints(problems).filter((p) => p.severity !== "warning" || p.elementId === undefined);

/** `problems` without the `trace.no-parent` hints. */
export const withoutNoParent = <P extends ProblemLike>(problems: readonly P[]): P[] =>
  problems.filter((p) => p.code !== NO_PARENT_CODE);
