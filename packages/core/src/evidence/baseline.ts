// The evidence of a baseline (SR-094, `baseline.get` with `withEvidence`): the verification status
// of an entry per view and its validation status, at its version in the baseline, from the records
// that count for the baseline (`countsFor` of the baselines block, which the command passes in: the
// evidence block lies above it).
//
// - Own records only (AK6): no walk to children, so no current version is read; the version is the
//   baseline's. The status rule is that of `evidence.status` (`verificationStatusOf`,
//   `validationOf`, ADR-0012 "Status rules"): records of other versions only give `outdated`,
//   none `open` (AK3); an `inconclusive` validation gives its `validationReason` (SR-172 AK2).
// - Rows (AK4, AK5): the views the command passes, a subset of `WorkspaceStatus.holders` (the core,
//   then the variants in store order, each with the view rule of now), and of these the ones the
//   entry applies in now, so a variant that excludes or replaces it has no row (SR-047 AK3). Whether
//   it applies is judged by the view rule and the variants of now, not by the content of the
//   baseline version, which is never read (D-033, N-036; assumption of spec question #657).
// - Validation (AK7): for a need and any other element with a validation record of any date
//   (`hasValidationStatus`, SR-038 as `WorkspaceStatus.validate`), without view.
// - Later (AK2): the records of the baseline version that hold in a row's view (validation: the
//   core) and are dated after the baseline, newest first (the index order). Records of other versions
//   dated after it are neither counted nor named. A later record of a view without a row (one that
//   leaves the entry out, or the core under AK5) is not named.
// - One pass over the entry's records groups the counting verification records by variant and the
//   later ones by variant, so V views cost O(records + V).
// - Variant-independent repositories (SR-173): for an entry whose repository the workspace file of
//   now marks `variant-independent` (`StatusSource.independent`; spec question #817 Q9, assumption),
//   a variant's row also counts the records without variant, and its `later` holds both groups,
//   merged in index order (newest first), as `holdsIn` gives them; only a row with records of both
//   groups costs one more pass over the entry's records.
import type { BaselineGetOutput } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import type { EvidenceRecord } from "./record.js";
import { hasValidationStatus, validationOf, verificationStatusOf } from "./status.js";
import type { ViewHolder, WorkspaceStatus } from "./verification.js";

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
 * of an `independent` element, the core's too, in the order of `records` (newest first), which both
 * groups keep. Undefined when none does.
 */
const heldIn = (
  groups: Groups,
  key: ViewKey,
  independent: boolean,
  records: readonly EvidenceRecord[],
): readonly EvidenceRecord[] | undefined => {
  const own = groups.get(key);
  const core = key === undefined || !independent ? undefined : groups.get(undefined);
  if (core === undefined || own === undefined) {
    return own ?? core;
  }
  const both = new Set([...own, ...core]);
  return records.filter((record) => both.has(record));
};

/** `validation` and `validationReason` of an entry from the counting validation records, or nothing. */
const validationFields = (
  validating: readonly EvidenceRecord[] | undefined,
  version: string,
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
  version: string,
  views: readonly ViewHolder[],
  groups: { readonly counting: Groups; readonly later: Groups },
  independent: boolean,
  records: readonly EvidenceRecord[],
): NonNullable<BaselineEvidence["verification"]> =>
  views.flatMap((holder) => {
    if (!holder.includes(element)) {
      return [];
    }
    const key = keyOf(holder);
    const after = heldIn(groups.later, key, independent, records);
    const counted = heldIn(groups.counting, key, independent, records) ?? NONE;
    return [
      {
        view: key ?? "core",
        status: verificationStatusOf(counted, version, holder.view, independent),
        ...(after === undefined ? {} : { later: [...after] }),
      },
    ];
  });

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
  ): ((element: ElementRecord, version: string) => BaselineEvidence) =>
  (element, version) => {
    const { source } = status;
    const records = source.recordsOf(element.id);
    const requirement = views !== undefined && source.requirements.has(element.type);
    const validation = hasValidationStatus(source, element, records);
    const counting = new Map<ViewKey, EvidenceRecord[]>();
    const later = new Map<ViewKey, EvidenceRecord[]>();
    const validating: EvidenceRecord[] = [];
    const validationLater: EvidenceRecord[] = [];
    for (const record of records) {
      const counted = counts(record.date);
      if (record.kind === "validation") {
        // Only the records of the core count (D-026, `validationOf`); so are the later ones.
        if (record.variant !== undefined) {
          continue;
        }
        if (counted) {
          validating.push(record);
        } else if (record.version === version) {
          validationLater.push(record);
        }
      } else if (requirement) {
        if (counted) {
          push(counting, record.variant, record);
        } else if (record.version === version) {
          push(later, record.variant, record);
        }
      }
    }
    const verification = requirement
      ? verificationRows(element, version, views, { counting, later }, source.independent(element), records)
      : undefined;
    return {
      ...(verification === undefined ? {} : { verification }),
      ...validationFields(validation ? validating : undefined, version),
      ...(validation && validationLater.length > 0 ? { validationLater } : {}),
    };
  };
