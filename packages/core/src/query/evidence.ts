// The evidence provider of the filter (SR-069 AK1 "Nachweisstatus", AK3 "ohne Nachweis"): the
// verification status of an element per view (SR-031, SR-034, SR-047), its validation status
// (SR-038), and whether evidence records point at it (the relation direction `evidence`). The
// conditions `verification`, `validation` and `{relation: {direction: evidence}}` ask only this
// provider, never the records themselves.
//
// Stage 4 computes the verification status from the evidence records (SR-031 ThomasBirkmaier/ReqSeq-archive#43) and, for a
// requirement without own record, from its children (SR-034 ThomasBirkmaier/ReqSeq-archive#46): each requirement (a type with the
// meaning `requirement`, own or inherited, SR-012) in each view it applies in (SR-040, SR-047 AK3).
// The validation status (SR-038 ThomasBirkmaier/ReqSeq-archive#50) comes from the validation records of the core: every need has
// one (`open` without record), a requirement only with a validation record, no other element (SR-038 AK5). Both come
// from the evidence block's `verificationState` (`evidence/verification.ts`), which element.get and
// evidence.status share. Only the elements that have records get a current version
// (`currentVersionsOf` with `build: false`: the files of those elements, or the kept versions of the
// whole store when they are built, ADR-0008), so a workspace without records reads no element file for it. The versions are
// read by `ready`, which the conditions `verification` and `validation` await once before they ask
// (#439): the condition "has evidence" needs no version and reads none. While the metamodel is not
// valid the records are not compared: every requirement is `open`, every need `open`, nothing has
// evidence, and `ready` reads nothing.
// "Has evidence" is `hasVerificationRecord` of the evidence block, with the mark of the element's
// repository from the shared status source (`independent`, SR-173): a verification record in the
// view, any version and result (spec question ThomasBirkmaier/ReqSeq-archive#527); validation records never count (D-007).
// The conditions are tested at core level with records given through `evidenceRecordsState` or a
// provider given through `evidenceStatusState` (decision on ThomasBirkmaier/ReqSeq-archive#127, option 1).
import type { ValidationStatus, VerificationStatus } from "../generated/types.js";
import type { EvidenceIndex, WorkspaceStatus } from "../evidence/index.js";
import { evidenceIndexState, hasVerificationRecord, verificationState } from "../evidence/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
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
  /**
   * Reads what `verification` and `validation` need (the current versions), once; await it before
   * asking them. Left out by a provider that needs nothing read (a test's).
   */
  readonly ready?: () => Promise<void>;
}

/**
 * The provider of the verification and validation `status` with the records of `index` and `ready`
 * (see the file comment).
 */
const providerOf = (
  status: WorkspaceStatus,
  index: EvidenceIndex | undefined,
  ready: () => Promise<void>,
): EvidenceStatuses => ({
  verification: (element, view) => status.evaluate(element, view)?.status,
  validation: (element) => status.validate(element)?.status,
  hasEvidence: (element, view) =>
    index !== undefined && hasVerificationRecord(index, element.id, view, status.source.independent(element)),
  ready,
});

const NOTHING_TO_READ = (): Promise<void> => Promise.resolve();

/** The provider of a workspace (see the file comment). */
const evidenceStatuses = async (workspace: Workspace): Promise<EvidenceStatuses> => {
  const [metamodel, status] = await Promise.all([
    workspace.get(metamodelState),
    workspace.get(verificationState),
  ]);
  if (!metamodel.valid) {
    return providerOf(status, undefined, NOTHING_TO_READ);
  }
  const [store, index] = await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(evidenceIndexState),
  ]);
  // Every element may be asked about: the versions of all requirements with verification records and
  // of all elements with validation records, one batch, on the first `ready`. A failed read is read
  // again by the next one.
  let prepared: Promise<void> | undefined;
  const ready = (): Promise<void> =>
    (prepared ??= status.prepare(store.elements, { own: true }).catch((error: unknown) => {
      prepared = undefined;
      throw error;
    }));
  return providerOf(status, index, ready);
};

/**
 * The evidence provider of a workspace (see the file comment). Reset with the metamodel, the element
 * store, the evidence records and the verification state.
 */
export const evidenceStatusState = defineWorkspaceState("evidence-status", evidenceStatuses, {
  dependsOn: [metamodelState, elementStoreState, evidenceIndexState, verificationState],
});
