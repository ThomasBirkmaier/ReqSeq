// The evidence of a baseline (SR-094, `baseline.get` with `withEvidence`): the verification status
// of an entry per view and its validation status, at its version in the baseline, from the records
// that count for the baseline (`countsFor` of the baselines block, which the command passes in: the
// evidence block lies above it).
//
// - Own records only (AK6): no walk to children; the version is the baseline's. A record of the
//   other normal form (n1, n2) than the entry counts when the entry is the element's current
//   version and the record is too (`storedForms`, with the current versions `baseline.get` reads
//   anyway; ADR-0005 "Normal form 2"); otherwise it is of another version. The status rule is that of `evidence.status` (`verificationStatusOf`,
//   `validationOf`, ADR-0012 "Status rules"): records of other versions only give `outdated`,
//   none `open` (AK3); an `inconclusive` validation gives its `validationReason` (SR-172 AK2).
// - Rows (AK4, AK5): the views the command passes, a subset of `WorkspaceStatus.holders` (the core,
//   then the variants in store order, each with the view rule of now), and of these the ones the
//   entry applies in now, so a variant that excludes or replaces it has no row (SR-047 AK3). Whether
//   it applies is judged by the view rule and the variants of now, not by the content of the
//   baseline version (D-033, N-036; assumption of spec question #657). Only its acceptance criteria
//   are read from it (SR-031): the element's own when the baseline holds its current version, else
//   from the start of that version in Git (`versionDatesAndValues`, the walk of the version dates,
//   page only), counted as `evidence.status` counts them (`baselineStatusOf`).
// - Validation (AK7): for a need and any other element with a validation record of the core of any
//   date (the rule of `hasValidationStatus`, SR-038 as `WorkspaceStatus.validate`, found in the
//   same pass), without view.
// - Later (AK2): the records of the baseline version that hold in a row's view (validation: the
//   core) and are dated after the baseline, newest first (the index order). Records of other versions
//   dated after it are neither counted nor named. A later record of a view without a row (one that
//   leaves the entry out, or the core under AK5) is not named.
// - One pass over the entry's records groups the counting verification records by variant and the
//   later ones by variant, so V views cost O(records + V).
// - Variant-independent repositories (SR-173): for an entry whose repository the workspace file of
//   now marks `variant-independent` (`StatusSource.independent`; spec question #817 Q9, assumption),
//   a variant's row also counts the records without variant, and its `later` holds both groups,
//   merged in index order (newest first), as `holdsIn` gives them; only the `later` of a row with
//   records of both groups costs one more pass over the entry's records (the status needs no order).
import type { BaselineGetOutput } from "../generated/types.js";
import type { ElementRecord, VersionForms } from "../model/index.js";
import { sameVersion, storedForms } from "../model/index.js";
import { withEvidenceSource } from "./evidence-source.js";
import type { EvidenceRecord } from "./record.js";
import type { OwnVerification } from "./status.js";
import { ownVerificationOf, validationOf, verificationStatusOf } from "./status.js";
import type { ViewHolder, WorkspaceStatus } from "./verification.js";
import type { View } from "../variants/index.js";

type Entry = BaselineGetOutput["elements"][number];

/** The evidence fields of an entry of `baseline.get`. */
export type BaselineEvidence = Pick<
  Entry,
  "verification" | "validation" | "validationReason" | "validationLater"
>;

/** The key of the view a record holds in: its variant, none for the core. */
type ViewKey = string | undefined;

const keyOf = ({ view }: ViewHolder): ViewKey => (view.kind === "core" ? undefined : view.variant.id);

/** Adds `record` to the list of `key` in `groups`. */
const push = (groups: Map<ViewKey, EvidenceRecord[]>, key: ViewKey, record: EvidenceRecord): void => {
  const list = groups.get(key);
  if (list === undefined) {
    groups.set(key, [record]);
  } else {
    list.push(record);
  }
};

const NONE: readonly EvidenceRecord[] = Object.freeze([]);

/** Records grouped by the view they hold in. */
type Groups = ReadonlyMap<ViewKey, readonly EvidenceRecord[]>;

/**
 * The records of `groups` that hold in the view `key` (`holdsIn`): its own group and, for a variant
 * of an `independent` element, the core's too; with `order`, in the order of `records` (newest
 * first), which both groups keep. Undefined when none does.
 */
const heldIn = (
  groups: Groups,
  key: ViewKey,
  independent: boolean,
  order?: readonly EvidenceRecord[],
): readonly EvidenceRecord[] | undefined => {
  const own = groups.get(key);
  const core = key === undefined || !independent ? undefined : groups.get(undefined);
  if (core === undefined || own === undefined) {
    return own ?? core;
  }
  if (order === undefined) {
    return [...own, ...core];
  }
  const both = new Set([...own, ...core]);
  return order.filter((record) => both.has(record));
};

/** `validation` and `validationReason` of an entry from the counting validation records, or nothing. */
const validationFields = (
  validating: readonly EvidenceRecord[] | undefined,
  version: VersionForms,
): Pick<BaselineEvidence, "validation" | "validationReason"> => {
  if (validating === undefined) {
    return {};
  }
  const { status, reason } = validationOf(validating, version);
  return { validation: status, ...(reason === undefined ? {} : { validationReason: reason }) };
};

/** The verification rows of `element` at `version` in `views` from its grouped records (see the file comment). */
const verificationRows = (
  element: ElementRecord,
  version: VersionForms,
  views: readonly ViewHolder[],
  groups: { readonly counting: Groups; readonly later: Groups },
  independent: boolean,
  records: readonly EvidenceRecord[],
  count: number | undefined,
): NonNullable<BaselineEvidence["verification"]> =>
  views.flatMap((holder) => {
    if (!holder.includes(element)) {
      return [];
    }
    const key = keyOf(holder);
    const after = heldIn(groups.later, key, independent, records);
    const counted = heldIn(groups.counting, key, independent) ?? NONE;
    const { status, criteria } = baselineStatusOf(counted, version, holder.view, independent, count);
    return [
      {
        view: key ?? "core",
        status,
        // Shared, not copied: the count without a record is one frozen object per count, and a
        // page holds up to hundreds of thousands of rows (N-036); outputs are never changed.
        ...(criteria === undefined ? {} : { criteria }),
        ...(after === undefined ? {} : { later: after.map(withEvidenceSource) }),
      },
    ];
  });

/**
 * The status of a row from its counting records with `count` acceptance criteria at the baseline's
 * version (SR-031 as `evidence.status`, `ownVerificationOf`). `count` undefined: Git does not have
 * that version, so its criteria are unknown (spec question #985, assumption). Then, when no record
 * names a criterion, the rule of the whole requirement; otherwise no count is given, a criterion
 * whose newest record of the version failed gives `failed` (the criteria as far as the records name
 * them), as do `open` and `outdated` (SR-094 AK3); `verified` only when the records that name no
 * criterion verify it, else `open`.
 */
export const baselineStatusOf = (
  counted: readonly EvidenceRecord[],
  version: VersionForms,
  view: View,
  independent: boolean,
  count: number | undefined,
): OwnVerification => {
  if (count !== undefined) {
    return ownVerificationOf(counted, version, view, independent, count);
  }
  // Per criterion as far as the records name them: a criterion whose newest record failed fails it.
  const named = Math.max(0, ...counted.flatMap((r) => r.criteria ?? []));
  const whole = verificationStatusOf(counted, version, view, independent, named);
  // Outdated only when every record is of another version (SR-094 AK3, #985): a criterion of an
  // older version next to one of this version leaves it open, as the count is unknown.
  if (
    whole === "outdated" &&
    counted.some((r) => r.kind === "verification" && sameVersion(r.version, version))
  ) {
    return { status: "open" };
  }
  if (whole !== "verified") {
    return { status: whole };
  }
  // Verified as far as the records name criteria: only the records for all show there are no others.
  const forAll = counted.filter((r) => r.criteria === undefined);
  return {
    status: verificationStatusOf(forAll, version, view, independent) === "verified" ? "verified" : "open",
  };
};

/** The records of an entry grouped in one pass (see the file comment). */
interface Grouped {
  /** The counting and the later verification records by variant; empty unless `requirement`. */
  readonly counting: Groups;
  readonly later: Groups;
  /** The counting and the later validation records of the core. */
  readonly validating: readonly EvidenceRecord[];
  readonly validationLater: readonly EvidenceRecord[];
  /** Whether a validation record of the core of any date is among them (`hasValidationRecord`). */
  readonly validated: boolean;
}

/** Groups the `records` of an entry at its `version` in one pass (see the file comment). */
const grouped = (
  records: readonly EvidenceRecord[],
  version: VersionForms,
  counts: (date: string) => boolean,
  requirement: boolean,
): Grouped => {
  const counting = new Map<ViewKey, EvidenceRecord[]>();
  const later = new Map<ViewKey, EvidenceRecord[]>();
  const validating: EvidenceRecord[] = [];
  const validationLater: EvidenceRecord[] = [];
  let validated = false;
  for (const record of records) {
    const counted = counts(record.date);
    if (record.kind === "validation") {
      // Only the records of the core count (D-026, `validationOf`); so are the later ones.
      if (record.variant !== undefined) {
        continue;
      }
      validated = true;
      if (counted) {
        validating.push(record);
      } else if (sameVersion(record.version, version)) {
        validationLater.push(record);
      }
    } else if (requirement) {
      if (counted) {
        push(counting, record.variant, record);
      } else if (sameVersion(record.version, version)) {
        push(later, record.variant, record);
      }
    }
  }
  return { counting, later, validating, validationLater, validated };
};

/**
 * The evidence of an entry at its `version` in a baseline (see the file comment): `views` are the
 * views of its rows (undefined: no verification, the stored view is gone), `counts` whether a record
 * date counts for the baseline (`countsFor`).
 */
export const baselineEvidence =
  (
    status: Pick<WorkspaceStatus, "source">,
    views: readonly ViewHolder[] | undefined,
    counts: (date: string) => boolean,
  ): ((
    element: ElementRecord,
    stored: string,
    current: VersionForms | undefined,
    values: Readonly<Record<string, unknown>> | undefined,
  ) => BaselineEvidence) =>
  (element, stored, current, values) => {
    const { source } = status;
    // A record of the other normal form counts through the current version (`storedForms`).
    const version = storedForms(stored, current);
    const records = source.recordsOf(element.id);
    const requirement = views !== undefined && source.requirements.has(element.type);
    const { counting, later, validating, validationLater, validated } = grouped(
      records,
      version,
      counts,
      requirement,
    );
    // SR-038 as `hasValidationStatus`: a need, and any other element with a validation record.
    const validation = validated || source.needs.has(element.type);
    const verification = requirement
      ? verificationRows(
          element,
          version,
          views,
          { counting, later },
          source.independent(element),
          records,
          values === undefined ? undefined : source.criteriaOf({ data: values }),
        )
      : undefined;
    return {
      ...(verification === undefined ? {} : { verification }),
      ...validationFields(validation ? validating : undefined, version),
      ...(validation && validationLater.length > 0
        ? { validationLater: validationLater.map(withEvidenceSource) }
        : {}),
    };
  };
