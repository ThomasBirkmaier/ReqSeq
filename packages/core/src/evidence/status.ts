// The verification status (Nachweisstatus, SR-031, ADR-0012 "Status rules"): a view derived from the
// evidence records and the current version of an element. It never is and never changes the
// element's `status`, which only people set (D-030, ADR-0002 rule 6).
//
// - Per element and view, the records of the kind asked for (`verification`; SR-038 reuses the rule
//   with `validation`) that hold in the view: in the core a record without `variant`, in a variant a
//   record for that variant (SR-047; the same rule as `hasVerificationRecord`).
// - Of these, the newest records of the current version decide (`date` as an instant): passed gives
//   `verified` (AK2), failed gives `failed` (AK3). When several have that newest date and one of them
//   failed, the status is `failed` (spec question #525 Q2, assumption).
// - Records only of other versions give `outdated` (AK4); none gives `open` (AK1). An element whose
//   current version is unknown (`CurrentVersion` `unknown`, #276) has no record of it: `outdated`
//   with records, `open` without.
// - Only elements whose type has the meaning `requirement` have a verification status (D-012: "Ein
//   Nachweis verweist immer auf ein Requirement"), in the core and each variant they apply in
//   (`appliesIn`, SR-040). While the metamodel is not valid the records are not compared (the
//   versions follow the metamodel): every requirement is `open`, as without records.
import type { DataExportElement, VerificationStatus } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { Validity, View } from "../variants/index.js";
import { appliesIn, validityOf, variantsOf } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { evidenceIndexState, instantOf } from "./by-element.js";
import type { EvidenceRecord } from "./record.js";

/** What the records of one kind say about an element in a view, before it is named for its kind. */
export type RecordStatus = "open" | "passed" | "failed" | "outdated";

/** The verification status computed from records; `indirect` comes with SR-034. */
export type RecordVerificationStatus = Exclude<VerificationStatus, "indirect">;

/** The verification entries of an element (`data-export.schema.json#/$defs/element` `verification`). */
export type VerificationEntries = NonNullable<DataExportElement["verification"]>;

/** Whether `record` holds in `view`: the core without variant, a variant for that variant (SR-047). */
export const holdsIn = (record: Pick<EvidenceRecord, "variant">, view: View): boolean =>
  record.variant === (view.kind === "core" ? undefined : view.variant.id);

/**
 * What the records of `kind` of one element say in `view`, measured against its `current` version
 * (see the file comment). `records` may come in any order and may hold records of other elements'
 * kinds and views; only those of `kind` that hold in `view` count. One pass over the records.
 */
export const recordStatusOf = (
  records: readonly EvidenceRecord[],
  kind: EvidenceRecord["kind"],
  current: string | undefined,
  view: View,
): RecordStatus => {
  let counted = false;
  let newest = Number.NEGATIVE_INFINITY;
  let ofCurrent = false;
  let failed = false;
  for (const record of records) {
    if (record.kind !== kind || !holdsIn(record, view)) {
      continue;
    }
    counted = true;
    if (current === undefined || record.version !== current) {
      continue;
    }
    const time = instantOf(record.date);
    if (!ofCurrent || time > newest) {
      newest = time;
      failed = false;
    }
    ofCurrent = true;
    failed ||= time === newest && record.result === "failed";
  }
  if (ofCurrent) {
    return failed ? "failed" : "passed";
  }
  return counted ? "outdated" : "open";
};

/** The verification status of an element in `view` from its records (SR-031, see the file comment). */
export const verificationStatusOf = (
  records: readonly EvidenceRecord[],
  current: string | undefined,
  view: View,
): RecordVerificationStatus => {
  const status = recordStatusOf(records, "verification", current, view);
  return status === "passed" ? "verified" : status;
};

/** What the verification status of the elements of a workspace is computed from. */
export interface StatusSource {
  /** The effective type keys with the meaning `requirement` (own or inherited, SR-012). */
  readonly requirements: ReadonlySet<string>;
  readonly validity: Validity | undefined;
  /** The records of an element by UUID; none while the metamodel is not valid. */
  readonly recordsOf: (id: string) => readonly EvidenceRecord[];
}

const NO_RECORDS: readonly EvidenceRecord[] = Object.freeze([]);

/**
 * The status source of `metamodel` with the records of `index`; without `index` (the metamodel is
 * not valid) no element has records.
 */
export const statusSource = (metamodel: Metamodel, index: EvidenceIndex | undefined): StatusSource => ({
  requirements: new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key)),
  validity: validityOf(metamodel),
  recordsOf: (id) => index?.byElement.get(id) ?? NO_RECORDS,
});

/**
 * The verification status of `element` in `view`, measured against its `current` version;
 * undefined when it has none there (no requirement, or it does not apply in the view, SR-040).
 */
export const verificationIn = (
  source: StatusSource,
  element: ElementRecord,
  view: View,
  current: string | undefined,
): RecordVerificationStatus | undefined =>
  source.requirements.has(element.type) && appliesIn(source.validity, element, view)
    ? verificationStatusOf(source.recordsOf(element.id), current, view)
    : undefined;

/**
 * The verification entries of `element` (`$defs/element` `verification`): the core and each of
 * `variants` it applies in, in that order, with its status there; undefined for an element that is
 * no requirement.
 */
export const verificationOf = (
  source: StatusSource,
  variants: readonly ElementRecord[],
  element: ElementRecord,
  current: string | undefined,
): VerificationEntries | undefined => {
  if (!source.requirements.has(element.type)) {
    return undefined;
  }
  const views: View[] = [
    { kind: "core" },
    ...variants.map((variant): View => ({ kind: "variant", variant })),
  ];
  return views.flatMap((view) => {
    const status = verificationIn(source, element, view, current);
    return status === undefined ? [] : [{ view: view.kind === "core" ? "core" : view.variant.id, status }];
  });
};

/** What the verification status of a workspace's elements needs, read once for one command. */
export interface WorkspaceStatus {
  readonly source: StatusSource;
  /** The variants of the workspace in store order (`variantsOf`). */
  readonly variants: readonly ElementRecord[];
}

/**
 * The status source of `workspace` (see the file comment): the records of `evidenceIndexState` while
 * the metamodel is valid, none otherwise.
 */
export const workspaceStatus = async (workspace: Workspace): Promise<WorkspaceStatus> => {
  const [metamodel, store] = await Promise.all([
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
  ]);
  const index = metamodel.valid ? await workspace.get(evidenceIndexState) : undefined;
  return { source: statusSource(metamodel, index), variants: variantsOf(store, metamodel) };
};

/** `element` with its verification entries (`verificationOf`), when it has any, measured against its own `version`. */
export const withVerification = (
  status: WorkspaceStatus,
  record: ElementRecord,
  element: DataExportElement,
): DataExportElement => {
  const verification = verificationOf(status.source, status.variants, record, element.version);
  return verification === undefined ? element : { ...element, verification };
};
