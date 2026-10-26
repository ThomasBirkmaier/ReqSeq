// The evidence provider of the filter (SR-069 AK1 "Nachweisstatus", AK3 "ohne Nachweis"): the
// verification status of an element per view (SR-031, SR-034, SR-047), its validation status
// (SR-038), and whether evidence records point at it (the relation direction `evidence`). The
// conditions `verification`, `validation` and `{relation: {direction: evidence}}` ask only this
// provider, never the records themselves.
//
// Evidence records and their status come in stage 4 (SR-028 #40, SR-031 #43, D-035). Until then the
// workspace has no records, so the provider stage 3 builds gives what no records give: every
// requirement (a type with the meaning `requirement`, own or inherited, SR-012) is `open` in each
// view it applies in (SR-031 AK1, SR-040, SR-047 AK3), every need (meaning `need`) has the
// validation status `open`, and no element has evidence. Elements of other types have no status.
// The conditions are tested at core level with a provider given through `evidenceStatusState`
// (decision on #127, option 1); stage 4 replaces the builder with the status computed from the
// records and adds the end-to-end tests with the same `[SR-069/AKn]` prefix.
import type { ValidationStatus, VerificationStatus } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import { appliesIn, validityOf } from "../variants/index.js";

/** What the filter asks about the evidence of an element (see the file comment). */
export interface EvidenceStatuses {
  /** The verification status of `element` in `view`; undefined when it has none there (no requirement, or not valid in the view). */
  readonly verification: (element: ElementRecord, view: View) => VerificationStatus | undefined;
  /** The validation status of `element`; undefined when it has none (no need). */
  readonly validation: (element: ElementRecord) => ValidationStatus | undefined;
  /** Whether evidence records point at `element` (SR-069 AK3 "ohne Nachweis"). */
  readonly hasEvidence: (element: ElementRecord) => boolean;
}

/** The provider of a workspace without evidence records (stage 3, see the file comment). */
const withoutRecords = (metamodel: Metamodel): EvidenceStatuses => {
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  const needs = new Set(typesWithMeaning(metamodel, "need").map((t) => t.key));
  const validity = validityOf(metamodel);
  return {
    verification: (element, view) =>
      requirements.has(element.type) && appliesIn(validity, element, view) ? "open" : undefined,
    validation: (element) => (needs.has(element.type) ? "open" : undefined),
    hasEvidence: () => false,
  };
};

/**
 * The evidence provider of a workspace (see the file comment). Built from the metamodel until stage
 * 4 reads the evidence records; reset with it.
 */
export const evidenceStatusState = defineWorkspaceState(
  "evidence-status",
  async (workspace): Promise<EvidenceStatuses> => withoutRecords(await workspace.get(metamodelState)),
  { dependsOn: [metamodelState] },
);
