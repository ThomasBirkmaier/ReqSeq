// The verification status (Nachweisstatus, SR-031, ADR-0012 "Status rules"): a view derived from the
// evidence records and the current version of an element. It never is and never changes the
// element's `status`, which only people set (D-030, ADR-0002 rule 6).
//
// - Per element and view, the records of the kind asked for (`verification`; SR-038 reuses the rule
//   with `validation`) that hold in the view (`holdsIn`): in the core a record without `variant`, in
//   a variant a record for that variant (SR-047; the same rule as `hasVerificationRecord`) and, for
//   an element whose repository the workspace file marks `variant-independent`
//   (`StatusSource.independent`), also a record without `variant` (SR-173 AK1). There both are pooled:
//   the newest decides, and a failed one wins a tie. Without the mark a record without `variant`
//   counts only in the core (SR-173 AK2). The element's repository decides, not the record's
//   folder (spec question #817 Q1, assumption); twins of one UUID each follow their own (#817 Q8).
// - Of these, the newest records of the current version decide (`date` as an instant): passed gives
//   `verified` (AK2), failed gives `failed` (AK3). When several have that newest date and one of them
//   failed, the status is `failed` (spec question ThomasBirkmaier/ReqSeq-archive#525 Q2, assumption).
// - Records only of other versions give `outdated` (AK4); none gives `open` (AK1). An element whose
//   current version is unknown (`CurrentVersion` `unknown`, ThomasBirkmaier/ReqSeq-archive#276) has no record of it: `outdated`
//   with records, `open` without.
// - Per acceptance criterion (D-072, AK5 to AK8, `ownVerificationOf`): an element with criteria (the
//   property with the meaning `acceptance-criteria`, `StatusSource.criteriaOf`) gets the rule above
//   per criterion, a record without `criteria` counting for each (AK6), one with `criteria` for the
//   current criteria they resolve to by key or number (AK11, AK12, `criteria.ts`); its status is failed when one
//   criterion failed, verified when all are, else open or outdated (see `ownVerificationOf`), with the
//   count of verified criteria (`CriteriaCount`). Without criteria the rule holds for the whole
//   requirement (AK7).
// - Only elements whose type has the meaning `requirement` have a verification status (D-012: "Ein
//   Nachweis verweist immer auf ein Requirement"), in the core and each variant whose view holds
//   them (the view rule, SR-040, SR-043; `ViewScope` of `indirect.ts`). While the metamodel is not valid the records are not compared (the
//   versions follow the metamodel): every requirement is `open`, as without records.
// The validation status (SR-038, `validationOf`) follows the same record rule for the records of
// kind `validation` of the core. A validation record may be `inconclusive` (SR-172 AK2): newest of the
// current version, it gives `inconclusive` with its `reason`; on a tie at the newest date `failed`
// comes before `inconclusive` before `passed` (spec question #807 Q3, assumption). A verification
// record is never inconclusive (the format refuses it, #807 Q2); one given otherwise counts as a
// record of no current version.
// The indirect verification of a requirement without own record (SR-034) is `indirect.ts`; the state
// that commands and the filter share is `verification.ts`.
import type {
  DataExportCriterionName,
  DataExportElement,
  ValidationStatus,
  VerificationStatus,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaItemsOf,
  emergentKeyOf,
  invalidStatuses,
  isEmergent,
} from "../model/index.js";
import type { Validity, View } from "../variants/index.js";
import { validityOf } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { instantOf } from "./by-element.js";
import { holdsIn } from "./holds.js";
import type { VersionForms } from "../model/index.js";
import { sameVersion } from "../model/index.js";
import type { EvidenceRecord } from "./record.js";
import type { ElementCriteria, OlderCriteria } from "./criteria.js";
import { criteriaFrom, criterionNameAt, elementCriteria, NO_OLDER_CRITERIA } from "./criteria.js";

/** What the records of one kind say about an element in a view, before it is named for its kind. */
export type RecordStatus = "open" | "passed" | "failed" | "inconclusive" | "outdated";

/**
 * The verification status computed from records alone; `indirect` comes from the children (SR-034,
 * `indirect.ts`).
 */
export type RecordVerificationStatus = Exclude<VerificationStatus, "indirect">;

/** The verification entries of an element (`data-export.schema.json#/$defs/element` `verification`). */
export type VerificationEntries = NonNullable<DataExportElement["verification"]>;

/**
 * Whether `record` (of `kind`) is a record of the `current` version that decides: an inconclusive one
 * only for validation (see the file comment).
 */
export const ofVersion = (
  record: EvidenceRecord,
  kind: EvidenceRecord["kind"],
  current: VersionForms | undefined,
): boolean =>
  current !== undefined &&
  sameVersion(record.version, current) &&
  (kind === "validation" || record.result !== "inconclusive");

/**
 * What the records of `kind` of one element say in `view`, measured against its `current` version
 * (see the file comment). `records` may come in any order and may hold records of other elements'
 * kinds and views; only those of `kind` that hold in `view` count (`holdsIn` with `independent`, the
 * mark of the element's repository, SR-173). One pass over the records.
 */
export const recordStatusOf = (
  records: readonly EvidenceRecord[],
  kind: EvidenceRecord["kind"],
  current: VersionForms | undefined,
  view: View,
  independent: boolean,
): RecordStatus => {
  let counted = false;
  let newest = Number.NEGATIVE_INFINITY;
  let ofCurrent = false;
  let failed = false;
  let inconclusive = false;
  for (const record of records) {
    if (record.kind !== kind || !holdsIn(record, view, independent)) {
      continue;
    }
    counted = true;
    if (!ofVersion(record, kind, current)) {
      continue;
    }
    ofCurrent = true;
    const time = instantOf(record.date);
    if (time < newest) {
      continue;
    }
    if (time > newest) {
      newest = time;
      failed = false;
      inconclusive = false;
    }
    failed ||= record.result === "failed";
    inconclusive ||= record.result === "inconclusive";
  }
  if (ofCurrent) {
    return failed ? "failed" : inconclusive ? "inconclusive" : "passed";
  }
  return counted ? "outdated" : "open";
};

/** How many acceptance criteria of a requirement are verified (`$defs/criteriaCount`, SR-031 AK5). */
export interface CriteriaCount {
  readonly verified: number;
  readonly total: number;
  /** The criteria that are not verified, by number ascending, with key and text (SR-205 AK2); left out when there is none. */
  readonly notVerified?: readonly DataExportCriterionName[];
}

/** The verification status of an element from its own records, with its criteria counted (SR-031). */
export interface OwnVerification {
  readonly status: RecordVerificationStatus;
  /** Left out for an element without acceptance criteria (AK7). */
  readonly criteria?: CriteriaCount;
}

/** What the records counted for one criterion (or for all, `criteria` left out) say, before they are merged. */
interface Tally {
  /** The newest instant among the deciding records of the current version, -Infinity without one. */
  newest: number;
  /** Whether one of the records at `newest` failed. */
  failed: boolean;
  /** Whether a deciding record of the current version is among them. */
  current: boolean;
  /** Whether any record is among them. */
  counted: boolean;
}

const tally = (): Tally => ({
  newest: Number.NEGATIVE_INFINITY,
  failed: false,
  current: false,
  counted: false,
});

/** Adds a verification record to `t`; `ofCurrent`: it is of the current version and decides. */
const add = (t: Tally, record: EvidenceRecord, ofCurrent: boolean): void => {
  t.counted = true;
  if (!ofCurrent) {
    return;
  }
  t.current = true;
  const time = instantOf(record.date);
  if (time > t.newest) {
    t.newest = time;
    t.failed = false;
  }
  t.failed ||= time === t.newest && record.result === "failed";
};

/** The status of one criterion from the records for all criteria and those naming it (AK1 to AK4, AK6). */
const criterionStatus = (all: Tally, own: Tally | undefined): RecordVerificationStatus => {
  if (all.current || own?.current === true) {
    const newest = Math.max(all.newest, own?.newest ?? Number.NEGATIVE_INFINITY);
    const failed =
      (all.current && all.newest === newest && all.failed) || (own?.newest === newest && own.failed);
    return failed ? "failed" : "verified";
  }
  return all.counted || own?.counted === true ? "outdated" : "open";
};

/** The results in which every criterion has one status, one frozen object per status (by the criteria items). */
type Uniform = Partial<Record<RecordVerificationStatus, OwnVerification>>;

const uniform = new WeakMap<readonly unknown[], Uniform>();

/**
 * The result when every criterion of `criteria` has `status` (none: no criteria, AK7): all verified,
 * or none (AK1, D-072: the tool shows how many are verified). Frozen and shared per criteria items:
 * no object per call (N-036, a baseline page asks it for hundreds of thousands of rows).
 */
const uniformWith = (status: RecordVerificationStatus, criteria: ElementCriteria): OwnVerification => {
  const known = uniform.get(criteria.items) ?? {};
  uniform.set(criteria.items, known);
  const cached = known[status];
  if (cached !== undefined) {
    return cached;
  }
  const { count, items } = criteria;
  const result: OwnVerification = Object.freeze(
    count === 0
      ? { status }
      : {
          status,
          criteria: Object.freeze(
            status === "verified"
              ? { verified: count, total: count }
              : {
                  verified: 0,
                  total: count,
                  notVerified: Object.freeze(
                    Array.from({ length: count }, (_, i) => Object.freeze(criterionNameAt(items, i + 1))),
                  ),
                },
          ),
        },
  );
  known[status] = result;
  return result;
};

/**
 * The verification status of an element with the acceptance criteria `criteria` (a count: criteria
 * without keys, `plainCriteria`) in `view` from its records (SR-031 AK1 to AK8, AK11, AK12, D-072;
 * `independent`: its repository is marked `variant-independent`, SR-173). Without criteria the
 * newest record of the current version decides for the whole requirement, whatever criteria it names
 * (AK7; spec answer to Q2 of the #963 plan). Otherwise a record that names no criterion counts for
 * every one (AK6), one that names criteria for the current criteria they resolve to
 * (`ElementCriteria.positionsOf`: by key, or by number in the version it names; one that resolves to
 * none counts for no criterion but still counts as a record, AK11, AK12), and each criterion gets the
 * status of its records by the rule of `recordStatusOf`. Whether the requirement has records at all
 * and whether one is of the current version is judged over all its counted records, whatever they
 * name (plan review B1). The first that holds: a criterion failed gives `failed` (AK3); all verified
 * give `verified` (AK2); no record gives `open` (AK1); no record of the current version gives
 * `outdated` (AK4); a criterion without record gives `open` (AK5, D-072); else some are only of older
 * versions: `outdated` (AK8). `criteria` counts them (frozen and shared without any record). One
 * pass over the records, then one over the criteria.
 */
export const ownVerificationOf = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
  view: View,
  independent: boolean,
  of: ElementCriteria | number,
): OwnVerification => {
  const criteria = criteriaFrom(of);
  const { count } = criteria;
  // Without criteria, or when no record names one (the common case): every criterion has the status
  // of the whole requirement, one shared result per status and criteria (N-036: no allocation per row).
  if (count === 0 || !records.some((r) => r.criteria !== undefined)) {
    const status = recordStatusOf(records, "verification", current, view, independent);
    // `recordStatusOf` gives `inconclusive` for validation records only (see the file comment).
    return uniformWith(status === "passed" ? "verified" : (status as RecordVerificationStatus), criteria);
  }
  const tallies = talliesOf(records, current, view, independent, criteria);
  // No record: open (AK1), none of the criteria verified.
  if (!tallies.counted) {
    return uniformWith("open", criteria);
  }
  const { named } = tallies;
  // No counted record names a criterion it has: every criterion has the status of the records for all.
  const statuses =
    named === undefined
      ? new Array<RecordVerificationStatus>(count).fill(criterionStatus(tallies.all, undefined))
      : Array.from({ length: count }, (_, i) => criterionStatus(tallies.all, named.get(i + 1)));
  const notVerified = statuses.flatMap((s, i) =>
    s === "verified" ? [] : [criterionNameAt(criteria.items, i + 1)],
  );
  return {
    status: combined(statuses, notVerified.length === 0, tallies),
    criteria: {
      verified: count - notVerified.length,
      total: count,
      ...(notVerified.length === 0 ? {} : { notVerified }),
    },
  };
};

/**
 * The status of each acceptance criterion of an element in `view` (SR-031, the rule of
 * `ownVerificationOf`), criterion n at position n - 1; without criteria one status for the whole
 * requirement (AK7). The rows of `evidence.list`'s `display` name the views by it (SR-032 AK4), so they
 * agree with the status by construction. One pass over the records.
 */
export const criterionStatusesOf = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
  view: View,
  independent: boolean,
  of: ElementCriteria | number,
): RecordVerificationStatus[] => {
  const criteria = criteriaFrom(of);
  if (criteria.count === 0) {
    const status = recordStatusOf(records, "verification", current, view, independent);
    // `recordStatusOf` gives `inconclusive` for validation records only (see the file comment).
    return [status === "passed" ? "verified" : (status as RecordVerificationStatus)];
  }
  const { all, named } = talliesOf(records, current, view, independent, criteria);
  return Array.from({ length: criteria.count }, (_, i) => criterionStatus(all, named?.get(i + 1)));
};

/** The tallies of the verification records of an element in a view (`ownVerificationOf`). */
interface Tallies {
  /** The records that name no criterion. */
  readonly all: Tally;
  /** The records that name a criterion, by its current position; undefined when none does. */
  readonly named: ReadonlyMap<number, Tally> | undefined;
  /** Whether any record counts, whatever it names. */
  readonly counted: boolean;
  /** Whether a deciding record of the current version counts, whatever it names. */
  readonly ofCurrent: boolean;
}

/** One pass over `records` (`ownVerificationOf`). */
const talliesOf = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
  view: View,
  independent: boolean,
  criteria: ElementCriteria,
): Tallies => {
  const all = tally();
  let named: Map<number, Tally> | undefined;
  let counted = false;
  let ofCurrent = false;
  for (const record of records) {
    if (record.kind !== "verification" || !holdsIn(record, view, independent)) {
      continue;
    }
    const deciding = ofVersion(record, "verification", current);
    counted = true;
    ofCurrent ||= deciding;
    const positions = criteria.positionsOf(record, current);
    if (positions === undefined) {
      add(all, record, deciding);
      continue;
    }
    for (const n of positions) {
      named ??= new Map<number, Tally>();
      const t = named.get(n) ?? tally();
      named.set(n, t);
      add(t, record, deciding);
    }
  }
  return { all, named, counted, ofCurrent };
};

/** The status of the requirement from the statuses of its criteria (`ownVerificationOf`, the order of its comment). */
const combined = (
  statuses: readonly RecordVerificationStatus[],
  allVerified: boolean,
  { ofCurrent }: Pick<Tallies, "ofCurrent">,
): RecordVerificationStatus => {
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (allVerified) {
    return "verified";
  }
  // Some record counts (`ownVerificationOf` returned before otherwise).
  if (!ofCurrent) {
    return "outdated";
  }
  return statuses.includes("open") ? "open" : "outdated";
};

/**
 * The verification status of an element in `view` from its records (SR-031, `ownVerificationOf`
 * with its acceptance `criteria`, 0 when it has none); `independent`: its repository is marked
 * `variant-independent` (SR-173).
 */
export const verificationStatusOf = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
  view: View,
  independent: boolean,
  criteria: ElementCriteria | number = 0,
): RecordVerificationStatus => ownVerificationOf(records, current, view, independent, criteria).status;

const CORE: View = Object.freeze({ kind: "core" });

/** The validation status of an element and, when it is `inconclusive`, the reason of the deciding record (SR-172 AK2). */
export interface Validation {
  readonly status: ValidationStatus;
  readonly reason?: string;
}

/** Whether `record` is a validation record of the core for `current` (`validationOf`). */
const validatesCurrent = (record: EvidenceRecord, current: VersionForms | undefined): boolean =>
  record.kind === "validation" &&
  holdsIn(record, CORE, false) &&
  current !== undefined &&
  sameVersion(record.version, current);

/**
 * The reason of an `inconclusive` validation (SR-172 AK2): the first inconclusive record, in the
 * order of `records`, among the newest validation records of the core for `current`. Only asked
 * when `recordStatusOf` gave `inconclusive`, so such a record exists.
 */
const reasonOf = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
): string | undefined => {
  let newest = Number.NEGATIVE_INFINITY;
  let reason: string | undefined;
  for (const record of records) {
    if (!validatesCurrent(record, current)) {
      continue;
    }
    const time = instantOf(record.date);
    if (time > newest) {
      newest = time;
      reason = undefined;
    }
    if (time === newest && reason === undefined && record.result === "inconclusive") {
      reason = record.reason;
    }
  }
  return reason;
};

/**
 * The validation status of an element from its records (SR-038, ADR-0012 "Status rules"): the
 * records of kind `validation` that hold in the core (no `variant`, D-026; the reader refuses a
 * validation record with one, SR-038 AK4, so this guards records given otherwise) by the rule of
 * `recordStatusOf`, `passed` named `validated` (AK3). Records only of other versions give
 * `outdated` (AK2, AK3), none gives `open` (AK3). Verification records never count (D-007, AK1).
 * `inconclusive` comes with the reason of the deciding record (SR-172 AK2).
 */
export const validationOf = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
): Validation => {
  const status = recordStatusOf(records, "validation", current, CORE, false);
  if (status === "inconclusive") {
    const reason = reasonOf(records, current);
    return reason === undefined ? { status } : { status, reason };
  }
  return { status: status === "passed" ? "validated" : status };
};

/** Whether `records` hold a validation record that counts (`validationOf`: the core's). */
export const hasValidationRecord = (records: readonly EvidenceRecord[]): boolean =>
  records.some((r) => r.kind === "validation" && holdsIn(r, CORE, false));

/**
 * Whether a validation record can name an element of `type` (D-012): a need or a requirement. A
 * validation record of any other element counts for no status (SR-038 AK5, #1360).
 */
export const validatesType = (source: Pick<StatusSource, "needs" | "requirements">, type: string): boolean =>
  source.needs.has(type) || source.requirements.has(type);

/**
 * Whether `element` has a validation status (SR-038): a need, and a requirement with a counted
 * validation record among its `records`; no other element (AK5).
 */
export const hasValidationStatus = (
  source: Pick<StatusSource, "needs" | "requirements">,
  element: Pick<ElementRecord, "type">,
  records: readonly EvidenceRecord[],
): boolean =>
  source.needs.has(element.type) || (source.requirements.has(element.type) && hasValidationRecord(records));

/** What the verification status of the elements of a workspace is computed from. */
export interface StatusSource {
  /** The effective type keys with the meaning `requirement` (own or inherited, SR-012). */
  readonly requirements: ReadonlySet<string>;
  /**
   * The effective type keys with the meaning `need`: they have a validation status without record
   * (SR-038, ThomasBirkmaier/ReqSeq-archive#534).
   */
  readonly needs: ReadonlySet<string>;
  /** The status keys the metamodel marks invalid (D-044): their elements count in no verification degree (SR-037). */
  readonly invalid: ReadonlySet<string>;
  readonly validity: Validity | undefined;
  /** The records of an element by UUID; none while the metamodel is not valid. */
  readonly recordsOf: (id: string) => readonly EvidenceRecord[];
  /** Whether an element is marked emergent (`isEmergent`, SR-035): it needs an own record, never `indirect`. */
  readonly emergent: (element: ElementRecord) => boolean;
  /**
   * Whether the workspace file marks the element's repository `variant-independent` (SR-173): its
   * records without variant hold in every view it applies in (`holdsIn`). Per element, not per UUID:
   * twins in two repositories may differ (SR-088).
   */
  readonly independent: (element: Pick<ElementRecord, "repository">) => boolean;
  /**
   * The acceptance criteria the element holds (the property with the meaning `acceptance-criteria`,
   * D-072; none without such a property), with the criteria its records count for (`criteria.ts`).
   */
  readonly criteriaOf: (element: Pick<ElementRecord, "id" | "data">) => ElementCriteria;
}

const NO_RECORDS: readonly EvidenceRecord[] = Object.freeze([]);

/**
 * The status source of `metamodel` with the records of `index`; without `index` (the metamodel is
 * not valid) no element has records. `independent` names the repositories the workspace file marks
 * `variant-independent` (`variantIndependentOf` of the layout, SR-173); `older` gives the criteria of
 * older versions (`olderCriteriaState`, SR-031 AK11).
 */
export const statusSource = (
  metamodel: Metamodel,
  index: EvidenceIndex | undefined,
  independent: ReadonlySet<string>,
  older: OlderCriteria = NO_OLDER_CRITERIA,
): StatusSource => {
  const emergentKey = emergentKeyOf(metamodel);
  const criteriaKey = acceptanceCriteriaKeyOf(metamodel);
  // One object per element data (N-036: the status asks it per row and view).
  const known = new WeakMap<object, ElementCriteria>();
  return {
    requirements: new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key)),
    needs: new Set(typesWithMeaning(metamodel, "need").map((t) => t.key)),
    invalid: new Set(invalidStatuses(metamodel).keys()),
    validity: validityOf(metamodel),
    recordsOf: (id) => index?.byElement.get(id) ?? NO_RECORDS,
    emergent: (element) => isEmergent(element, emergentKey),
    independent: (element) => independent.has(element.repository),
    criteriaOf: (element) => {
      const found = known.get(element.data);
      if (found !== undefined) {
        return found;
      }
      const criteria = elementCriteria(element.id, criteriaItemsOf(element.data, criteriaKey), older);
      known.set(element.data, criteria);
      return criteria;
    },
  };
};
