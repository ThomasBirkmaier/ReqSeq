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
// The indirect verification of a requirement without own record (SR-034) is `indirect.ts`; the state
// that commands and the filter share is `verification.ts`.
import type { DataExportElement, VerificationStatus } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { Validity, View } from "../variants/index.js";
import { validityOf } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { instantOf } from "./by-element.js";
import type { EvidenceRecord } from "./record.js";

/** What the records of one kind say about an element in a view, before it is named for its kind. */
export type RecordStatus = "open" | "passed" | "failed" | "outdated";

/** The verification status computed from records alone; `indirect` comes from the children (SR-034, `indirect.ts`). */
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
