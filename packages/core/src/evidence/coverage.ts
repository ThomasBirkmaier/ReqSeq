// The coverage of a selection (SR-036, D-044; `evidence.coverage`): per level, how many elements have
// children and how many have evidence, with the elements behind every number (AK2).
//
// - A level is an element type with the meaning `need` or `requirement` (own or inherited, SR-012;
//   a subtype is its own level), in metamodel order; the elements of other types have no level
//   (assumption, spec question #527 Q1, Q2). Only levels with a counted element are listed.
// - The views are the selection's (its own, then the saved filter's); without one, the core (AK5:
//   „Gegeben eine Auswahl ohne gewählte Variante ... dann zählen nur Requirements, Children und
//   Nachweise des Kerns“; #203 Q4, as the degree, the matrix and the filter count).
// - Counted are the elements whose status the metamodel does not mark invalid (AK4, D-044:
//   „Ungültige Elemente zählen weder für die Abdeckung ...“) and that every view holds
//   (`viewsInclude`, the view rule; without a selected view an element valid only in a variant).
// - Children: the derivation children of the trace block (`childrenOf`: incoming relations of a kind
//   with the meaning `derivation`, in any repository; one named only by an ambiguous relation, SR-088,
//   is none) that are counted by the same rule, so a child of a replaced or excluded core requirement
//   counts only where its own validity puts it, and the replaced one is no child in the variant
//   (SR-041 AK5, SR-043 AK5; as the chain and the matrix narrow them).
// - Evidence, only for a type with the meaning `requirement` (D-012: „Ein Nachweis verweist immer auf
//   ein Requirement“): `hasVerificationRecord` of the index in the first view (as the filter
//   condition `verification`). Any version and any result count (spec question #527 Q3), the same
//   rule as the filter's „ohne Nachweis“ and the chain's `no-evidence` gap.
// Nothing here reads or writes a status beyond comparing it with the metamodel (D-030). Cost: one pass
// over the selection, each element's incoming relations once (N-036).
import type { EvidenceCoverageOutput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { invalidStatuses } from "../model/index.js";
import type { DerivationGraph } from "../trace/index.js";
import { childrenOf } from "../trace/index.js";
import type { View } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { hasVerificationRecord } from "./by-element.js";

/** One level of the coverage, as `evidence.coverage` gives it. */
export type CoverageLevel = EvidenceCoverageOutput["levels"][number];

/** What decides the coverage of each element (see the file comment); `coverageRules` builds it. */
export interface CoverageRules {
  /** The level types in metamodel order, each with whether evidence counts for it. */
  readonly levels: ReadonlyMap<string, boolean>;
  /** Whether the element is counted at all (AK4, AK5): its status is valid and every view holds it. */
  readonly counts: (element: ElementRecord) => boolean;
  readonly hasChild: (element: ElementRecord) => boolean;
  readonly hasEvidence: (element: ElementRecord) => boolean;
}

/** The level types of `metamodel`: need types without, requirement types with evidence, in metamodel order. */
const levelTypes = (metamodel: Metamodel): ReadonlyMap<string, boolean> => {
  const needs = new Set(typesWithMeaning(metamodel, "need").map((t) => t.key));
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  const levels = new Map<string, boolean>();
  for (const { key } of metamodel.types) {
    if (requirements.has(key) || needs.has(key)) {
      levels.set(key, requirements.has(key));
    }
  }
  return levels;
};

/**
 * The rules of the coverage on `graph` and the evidence `index`, for the selection's `views` (its own
 * view first, then the saved filter's; at least one, the core when the selection names none) and
 * `includes`, whether every one of them holds an element (`viewsInclude`).
 */
export const coverageRules = (
  graph: DerivationGraph,
  index: EvidenceIndex,
  views: readonly [View, ...View[]],
  includes: (element: ElementRecord) => boolean,
): CoverageRules => {
  const { metamodel } = graph;
  const invalid = invalidStatuses(metamodel);
  const counts = (element: ElementRecord): boolean =>
    !invalid.has(String(element.data["status"])) && includes(element);
  return {
    levels: levelTypes(metamodel),
    counts,
    hasChild: (element) => childrenOf(graph, element).steps.some(({ to }) => counts(to)),
    hasEvidence: (element) => hasVerificationRecord(index, element.id, views[0]),
  };
};

/** The coverage of `elements` (in selection order) by `rules`: one level per level type with a counted element. */
export const coverageOf = (elements: readonly ElementRecord[], rules: CoverageRules): CoverageLevel[] => {
  const byType = new Map<string, ElementRecord[]>();
  for (const element of elements) {
    if (rules.levels.has(element.type) && rules.counts(element)) {
      const own = byType.get(element.type) ?? [];
      own.push(element);
      byType.set(element.type, own);
    }
  }
  const levels: CoverageLevel[] = [];
  for (const [type, evidence] of rules.levels) {
    const counted = byType.get(type);
    if (counted === undefined) {
      continue;
    }
    const withChildren: string[] = [];
    const withoutChildren: string[] = [];
    const withEvidence: string[] = [];
    const withoutEvidence: string[] = [];
    for (const element of counted) {
      (rules.hasChild(element) ? withChildren : withoutChildren).push(element.id);
      if (evidence) {
        (rules.hasEvidence(element) ? withEvidence : withoutEvidence).push(element.id);
      }
    }
    levels.push({
      type,
      total: counted.length,
      withChildren: withChildren.length,
      ...(evidence ? { withEvidence: withEvidence.length } : {}),
      elements: {
        withChildren,
        withoutChildren,
        ...(evidence ? { withEvidence, withoutEvidence } : {}),
      },
    });
  }
  return levels;
};
