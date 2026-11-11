// Reference model of the own-record status rules (#1394). Written from the spec and README.md only; each
// function names its rule (V…, A… in README.md) and the SR/AK it comes from. Deliberately naive: no index,
// no sorting, plain loops over small inputs.

/** An acceptance criterion; its number is its position, counted from 1 (D-072). */
export interface ModelCriterion {
  readonly key?: string;
}

/** How a record names a criterion: by criterion key or by number (D-072). */
export type ModelCriterionRef =
  { readonly by: "key"; readonly key: string } | { readonly by: "number"; readonly number: number };

/** An older version of the requirement; `criteria` is absent when that version's criteria are not known. */
export interface ModelOlderVersion {
  readonly id: string;
  readonly criteria?: readonly ModelCriterion[];
}

export type ModelResult = "passed" | "failed" | "inconclusive";

export interface ModelRecord {
  readonly kind: "verification" | "validation";
  /** `current`, or the `id` of an older version. */
  readonly version: string;
  readonly date: string;
  readonly result: ModelResult;
  readonly reason?: string;
  /** Absent: the record names no criterion. */
  readonly criteria?: readonly ModelCriterionRef[];
}

/** One requirement (or need) with its own records, in one view. */
export interface ModelElement {
  readonly criteria: readonly ModelCriterion[];
  readonly olderVersions: readonly ModelOlderVersion[];
  readonly records: readonly ModelRecord[];
}

export const CURRENT = "current";

export type ModelVerificationStatus = "open" | "verified" | "failed" | "outdated";
export type ModelValidationStatus = "open" | "validated" | "failed" | "inconclusive" | "outdated";

export interface ModelVerification {
  readonly status: ModelVerificationStatus;
  /** Status per criterion, in criterion order; empty without criteria. */
  readonly criteria: readonly ModelVerificationStatus[];
  /** Number of verified criteria (V16). */
  readonly verified: number;
}

export interface ModelValidation {
  readonly status: ModelValidationStatus;
  readonly reason?: string;
}

// V1, A1 (D-007): verification and validation records are kept apart.
export function recordsOfKind(element: ModelElement, kind: ModelRecord["kind"]): ModelRecord[] {
  return element.records.filter((record) => record.kind === kind);
}

// V2 (SR-031 AK2, AK4): a record is of the current version or of an older one.
export function isCurrent(record: ModelRecord): boolean {
  return record.version === CURRENT;
}

// V7, V8 (ADR-0012): a date as an instant; one that cannot be read is the oldest.
export function instantOf(date: string): number {
  const instant = Date.parse(date);
  return Number.isNaN(instant) ? Number.NEGATIVE_INFINITY : instant;
}

// V7, V8, V9, A4: all records at the newest instant (several on a tie).
export function newestOf(records: readonly ModelRecord[]): ModelRecord[] {
  let newest = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    newest = Math.max(newest, instantOf(record.date));
  }
  return records.filter((record) => instantOf(record.date) === newest);
}

// V11, V12 (D-072, SR-031 AK12): a record of the current version names the criterion at `index` by key or number.
export function currentRecordNames(
  ref: ModelCriterionRef,
  criterion: ModelCriterion,
  index: number,
): boolean {
  if (ref.by === "number") {
    return ref.number === index + 1;
  }
  return criterion.key !== undefined && criterion.key === ref.key;
}

// V13 (SR-031 AK11): the key a ref of an older-version record stands for, or undefined when it stands for none.
export function olderRefKey(
  ref: ModelCriterionRef,
  older: ModelOlderVersion | undefined,
): string | undefined {
  if (ref.by === "key") {
    return ref.key;
  }
  return older?.criteria?.[ref.number - 1]?.key;
}

// V10, V11, V12, V13 (SR-031 AK6, AK11, AK12): whether a record counts for the criterion at `index`.
export function countsForCriterion(
  record: ModelRecord,
  element: ModelElement,
  criterion: ModelCriterion,
  index: number,
): boolean {
  if (record.criteria === undefined) {
    return true;
  }
  if (isCurrent(record)) {
    return record.criteria.some((ref) => currentRecordNames(ref, criterion, index));
  }
  const older = element.olderVersions.find((version) => version.id === record.version);
  const key = criterion.key;
  return key !== undefined && record.criteria.some((ref) => olderRefKey(ref, older) === key);
}

// V4, V5, V9 (SR-031 AK2, AK3, AK10): the newest current records decide, failed as soon as one tied record failed.
export function decideByNewest(currentRecords: readonly ModelRecord[]): "verified" | "failed" {
  return newestOf(currentRecords).some((record) => record.result === "failed") ? "failed" : "verified";
}

// V4, V5, V6 (SR-031 AK2, AK3, AK4, AK8): the status of a set of counting records.
export function statusOfRecords(records: readonly ModelRecord[]): ModelVerificationStatus {
  const current = records.filter(isCurrent);
  if (current.length > 0) {
    return decideByNewest(current);
  }
  return records.length > 0 ? "outdated" : "open";
}

// V15 (SR-031 AK9, with AK4, AK5, AK8 as its cases): the requirement's status from its criteria.
export function combineCriteria(
  statuses: readonly ModelVerificationStatus[],
  hasCurrentRecord: boolean,
  hasOlderRecord: boolean,
): ModelVerificationStatus {
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (!hasCurrentRecord && hasOlderRecord) {
    return "outdated";
  }
  if (statuses.includes("open")) {
    return "open";
  }
  if (statuses.includes("outdated")) {
    return "outdated";
  }
  return "verified";
}

// V3, V14, V15, V16 (SR-031 AK1, AK5, AK7, AK9): the verification status of the element from its own records.
export function verificationOf(element: ModelElement): ModelVerification {
  const records = recordsOfKind(element, "verification");
  if (element.criteria.length === 0) {
    return { status: statusOfRecords(records), criteria: [], verified: 0 };
  }
  const criteria = element.criteria.map((criterion, index) =>
    statusOfRecords(records.filter((record) => countsForCriterion(record, element, criterion, index))),
  );
  const status = combineCriteria(
    criteria,
    records.some(isCurrent),
    records.some((record) => !isCurrent(record)),
  );
  return { status, criteria, verified: criteria.filter((value) => value === "verified").length };
}

// A4 (SR-038 AK3): the worse of two results, failed before inconclusive before passed.
export function worseResult(a: ModelResult, b: ModelResult): ModelResult {
  const rank: Record<ModelResult, number> = { failed: 2, inconclusive: 1, passed: 0 };
  return rank[b] > rank[a] ? b : a;
}

// A2, A3, A4, A5, A6 (SR-038 AK2, AK3, SR-172 AK2): the validation status of the element.
export function validationOf(element: ModelElement): ModelValidation {
  const records = recordsOfKind(element, "validation");
  const current = records.filter(isCurrent);
  if (current.length === 0) {
    return { status: records.length > 0 ? "outdated" : "open" };
  }
  const newest = newestOf(current);
  let result: ModelResult = "passed";
  for (const record of newest) {
    result = worseResult(result, record.result);
  }
  if (result === "passed") {
    return { status: "validated" };
  }
  if (result === "failed") {
    return { status: "failed" };
  }
  const reason = newest.find((record) => record.result === "inconclusive")?.reason;
  return reason === undefined ? { status: "inconclusive" } : { status: "inconclusive", reason };
}
