// The names a dry run (SR-246) gives the element it would write on its problems: the short ID and identifier
// of the planned element, as a write gives them. The runtime (`withElementShortIds`) names a problem from the
// store, which holds the element only as it was, or not at all; a problem that names it is matched as
// `problemElement` and `problemTarget` match (`short-id.ts`): by UUID and repository.
import type { Problem } from "../generated/types.js";
import type { ShortIds } from "./short-id.js";
import type { DryRun } from "./write.js";

/** The fields `withPlannedNames` reads of a result. */
interface Named {
  readonly element: { readonly problems: readonly Problem[] };
  readonly problems: readonly Problem[];
  readonly dryRun?: DryRun;
}

/**
 * `result` with the short ID and identifier of the planned element (`dryRun.record`) on each of its problems
 * and those of its element that name it as element or as target; `result` itself without a planned element.
 */
export const withPlannedNames = <T extends Named>(result: T, shortIds: ShortIds): T => {
  const record = result.dryRun?.record;
  if (record === undefined) {
    return result;
  }
  const shortId = shortIds.of(record);
  const identifier = shortIds.identifierOf(record);
  const planned = (id: string | undefined, repository: string | undefined): boolean =>
    id === record.id && repository === record.repository;
  const namesOf = (prefix: "element" | "target"): Partial<Problem> => ({
    [`${prefix}ShortId`]: shortId,
    ...(identifier === undefined ? {} : { [`${prefix}Identifier`]: identifier }),
  });
  const named = (problems: readonly Problem[]): Problem[] =>
    problems.map((problem) => ({
      ...problem,
      ...(planned(problem.elementId, problem.elementRepository ?? problem.repository)
        ? namesOf("element")
        : {}),
      ...(planned(problem.targetId, problem.targetRepository) ? namesOf("target") : {}),
    }));
  return {
    ...result,
    element: { ...result.element, problems: named(result.element.problems) },
    problems: named(result.problems),
  };
};
