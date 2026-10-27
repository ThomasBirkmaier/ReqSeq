// The evidence provider of the filter (SR-069 AK1 "Nachweisstatus", AK3 "ohne Nachweis"): the
// verification status of an element per view (SR-031, SR-034, SR-047), its validation status
// (SR-038), and whether evidence records point at it (the relation direction `evidence`). The
// conditions `verification`, `validation` and `{relation: {direction: evidence}}` ask only this
// provider, never the records themselves.
//
// Stage 4 computes the verification status from the evidence records (SR-031 #43, evidence block,
// `evidence/status.ts`): each requirement (a type with the meaning `requirement`, own or inherited,
// SR-012) in each view it applies in (SR-040, SR-047 AK3), measured against its current version.
// Only the requirements that have records get a current version (`currentVersionsOf`: the files of
// those elements, or the whole store when they are a large share of it, ADR-0008), so a workspace
// without records reads no element file for it. While the metamodel is not valid the records are
// not compared and every requirement is `open`. "Has evidence" is `hasVerificationRecord` of the
// evidence block: a verification record in the view, any version and result (spec question #527).
// The validation status stays `open` for every need until SR-038 (#50) computes it.
// The conditions are tested at core level with records given through `evidenceRecordsState` or a
// provider given through `evidenceStatusState` (decision on #127, option 1).
import type { ValidationStatus, VerificationStatus } from "../generated/types.js";
import type { EvidenceIndex, StatusSource } from "../evidence/index.js";
import {
  evidenceIndexState,
  hasVerificationRecord,
  statusSource,
  verificationIn,
} from "../evidence/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { CurrentVersion, ElementRecord } from "../model/index.js";
import { currentVersionsOf, elementStoreState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";

/** What the filter asks about the evidence of an element (see the file comment). */
export interface EvidenceStatuses {
  /** The verification status of `element` in `view`; undefined when it has none there (no requirement, or not valid in the view). */
  readonly verification: (element: ElementRecord, view: View) => VerificationStatus | undefined;
  /** The validation status of `element`; undefined when it has none (no need). */
  readonly validation: (element: ElementRecord) => ValidationStatus | undefined;
  /** Whether verification records point at `element` in `view` (SR-069 AK3 "ohne Nachweis"). */
  readonly hasEvidence: (element: ElementRecord, view: View) => boolean;
}

/** The provider of `source` with the current versions `versions` and the records of `index` (see the file comment). */
const providerOf = (
  metamodel: Metamodel,
  source: StatusSource,
  index: EvidenceIndex | undefined,
  versions: ReadonlyMap<ElementRecord, CurrentVersion>,
): EvidenceStatuses => {
  const needs = new Set(typesWithMeaning(metamodel, "need").map((t) => t.key));
  const current = (element: ElementRecord): string | undefined => {
    const entry = versions.get(element);
    return entry?.kind === "version" ? entry.version : undefined;
  };
  return {
    verification: (element, view) => verificationIn(source, element, view, current(element)),
    validation: (element) => (needs.has(element.type) ? "open" : undefined),
    hasEvidence: (element, view) => index !== undefined && hasVerificationRecord(index, element.id, view),
  };
};

/** The provider of a workspace (see the file comment). */
const evidenceStatuses = async (workspace: Workspace): Promise<EvidenceStatuses> => {
  const metamodel = await workspace.get(metamodelState);
  if (!metamodel.valid) {
    return providerOf(metamodel, statusSource(metamodel, undefined), undefined, new Map());
  }
  const [store, index] = await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(evidenceIndexState),
  ]);
  const source = statusSource(metamodel, index);
  // Only requirements with records need their current version (N-036).
  const recorded = store.elements.filter((e) => source.requirements.has(e.type) && index.byElement.has(e.id));
  const versions = recorded.length === 0 ? new Map() : await currentVersionsOf(workspace, recorded);
  return providerOf(metamodel, source, index, versions);
};

/**
 * The evidence provider of a workspace (see the file comment). Reset with the metamodel, the element
 * store and the evidence records.
 */
export const evidenceStatusState = defineWorkspaceState("evidence-status", evidenceStatuses, {
  dependsOn: [metamodelState, elementStoreState, evidenceIndexState],
});
