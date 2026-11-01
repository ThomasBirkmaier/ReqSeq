// The evidence of a baseline (SR-094, `baseline.get` with `withEvidence`): the verification status
// of an entry per view and its validation status, at its version in the baseline, from the records
// that count for the baseline (`countsFor` of the baselines block, which the command passes in: the
// evidence block lies above it).
//
// - Own records only (AK6): no walk to children, so no current version is read; the version is the
//   baseline's. The status rule is that of `evidence.status` (`verificationStatusOf`,
//   `validationStatusOf`, ADR-0012 "Status rules"): records of other versions only give `outdated`,
//   none `open` (AK3).
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
import type { BaselineGetOutput } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import type { EvidenceRecord } from "./record.js";
import { hasValidationStatus, validationStatusOf, verificationStatusOf } from "./status.js";
import type { ViewHolder, WorkspaceStatus } from "./verification.js";

type Entry = BaselineGetOutput["elements"][number];

/** The evidence fields of an entry of `baseline.get`. */
export type BaselineEvidence = Pick<Entry, "verification" | "validation" | "validationLater">;

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
        // Only the records of the core count (D-026, `validationStatusOf`); so are the later ones.
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
      ? views.flatMap((holder) => {
          if (!holder.includes(element)) {
            return [];
          }
          const key = keyOf(holder);
          const after = later.get(key);
          return [
            {
              view: key ?? "core",
              status: verificationStatusOf(counting.get(key) ?? NONE, version, holder.view),
              ...(after === undefined ? {} : { later: after }),
            },
          ];
        })
      : undefined;
    return {
      ...(verification === undefined ? {} : { verification }),
      ...(validation ? { validation: validationStatusOf(validating, version) } : {}),
      ...(validation && validationLater.length > 0 ? { validationLater } : {}),
    };
  };
