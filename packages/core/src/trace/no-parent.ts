// Requirements without a parent (SR-022 AK5, AK6) for `workspace.check` (SR-019): "Gegeben dasselbe
// Element, wenn der Bestand geprüft wird (CLI, API, MCP: `workspace.check`), dann meldet das Tool es
// als Hinweis mit seiner ID." An element of a type with the meaning `requirement` that names no
// parent through a relation kind with the meaning `derivation` (`namesParent`, the rule of the chain's
// `no-parent` gap) is a finding `trace.no-parent`.
//
// - Severity `warning` about the element (`elementId`): a hint in the sense of the glossary
//   („Hinweis“: the element should be checked; it blocks nothing and changes no status), so
//   `hint.list` lists it as well (`isHint`), and the default `failOn: error` keeps `ok` (#304). It has
//   no `hintId`: there is nothing to confirm (D-042 confirms a stored version); giving the element a
//   parent, or a relation kind of the project's metamodel the meaning `derivation`, settles it.
// - Which relation kinds derive is the metamodel's (D-012): in the standard model `based-on` has no
//   meaning, so a requirement based only on a decision is reported (product owner decision,
//   2026-11-01). A parent in a repository that is not here, or a missing target (SR-089, an error of
//   its own), still is a parent. An element with a status the metamodel marks invalid (superseded,
//   D-044, D-045) is left out: a retired element needs no origin, and nothing else could settle its
//   hint (the reading of AK6; as `evidence.coverage` leaves it out). The chain's gap stays, as for its
//   other gaps.
// - No line: the finding is about something the file lacks, so there is no line to point at, and
//   no file is read again (`locateFindings` re-reads every file with findings; a workspace without
//   derivations would re-read all of them).
// - Cost (N-036): one pass over the store and the derivation items of each requirement, no target
//   looked up; short IDs for the elements reported. Without a relation kind with the meaning
//   `derivation`, or a type with the meaning `requirement`, there is nothing to report (the info of
//   the missing derivation meaning comes from `derivationCycleProblemsState`). Against a metamodel
//   that is not valid nothing is reported (#208, #220).
import type { Problem } from "../catalog.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, LocatableFinding, ShortIds } from "../model/index.js";
import { elementLabel, elementStoreState, invalidStatuses, shortIdState } from "../model/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { DerivationGraph } from "./graph.js";
import { derivationKinds, namesParent } from "./graph.js";

/** The findings `trace.no-parent` of `store`, in store order (see the file comment). */
export const noParentProblems = (
  graph: Pick<DerivationGraph, "kinds" | "metamodel">,
  store: Pick<ElementStore, "elements">,
  shortIds: ShortIds,
): Problem[] => {
  const requirements = new Set(typesWithMeaning(graph.metamodel, "requirement").map((t) => t.key));
  const invalid = invalidStatuses(graph.metamodel);
  const problems: Problem[] = [];
  for (const element of store.elements) {
    if (
      requirements.has(element.type) &&
      !invalid.has(String(element.data["status"])) &&
      !namesParent(graph, element)
    ) {
      problems.push({
        code: "trace.no-parent",
        severity: "warning",
        message: `${elementLabel({ metamodel: graph.metamodel, shortIds }, element)} has no parent: no relation with the meaning derivation names one`,
        repository: element.repository,
        file: element.file,
        elementId: element.id,
      });
    }
  }
  return problems;
};

/** What the hint of one element reads (`elementHints`). */
export interface ElementNoParentContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/**
 * The hint `trace.no-parent` of one element shown (SR-026 AK3), as `noParentProblemsState` gives it
 * for that element: the same rule on the element alone, so no state of the whole workspace is built.
 */
export const elementNoParentFindings = (
  context: ElementNoParentContext,
  element: ElementRecord,
): LocatableFinding[] => {
  const { metamodel, shortIds } = context;
  if (!metamodel.valid || metamodel.meanings.derivation.length === 0) {
    return [];
  }
  const graph = { kinds: derivationKinds(metamodel, "element.get"), metamodel };
  return noParentProblems(graph, { elements: [element] }, shortIds).map((problem) => ({
    element,
    path: [],
    at: "line",
    problem,
  }));
};

/**
 * Every requirement of the workspace without a parent, as a hint with repository, file and element
 * (SR-022 AK6), for `workspace.check` and `hint.list`. Kept until the element store or the metamodel
 * is reset.
 */
export const noParentProblemsState = defineWorkspaceState(
  "no-parent",
  async (workspace): Promise<readonly Problem[]> => {
    const metamodel = await workspace.get(metamodelState);
    if (!metamodel.valid || metamodel.meanings.derivation.length === 0) {
      return [];
    }
    const kinds = derivationKinds(metamodel, "workspace.check");
    const store = await workspace.get(elementStoreState);
    return noParentProblems({ kinds, metamodel }, store, await workspace.get(shortIdState));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
