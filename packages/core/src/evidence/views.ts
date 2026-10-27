// The evidence records of one element as `evidence.list` shows them (SR-032): each record with its
// version, item (Prüfling), date, result and evidence (Beleg) as read (AK1), and the baselines that
// contain its version (AK2, `baselines`). Pure: the records come from the index, the baselines from
// the caller.
import type { View } from "../variants/index.js";
import type { EvidenceRecord } from "./record.js";

/**
 * Whether `record` holds for `view`: in the core a record without a variant, in a variant a record
 * for that variant (SR-047 AK1, AK2), as `hasVerificationRecord` counts; without a view every record.
 */
export const recordHoldsIn = (record: EvidenceRecord, view: View | undefined): boolean =>
  view === undefined || record.variant === (view.kind === "core" ? undefined : view.variant.id);

/**
 * `records` (newest first, as the index keeps them) that hold for `view`, each with the names of the
 * baselines that contain its version (`containing`, SR-032 AK2): an empty list when none does.
 */
export const listedRecords = (
  records: readonly EvidenceRecord[],
  view: View | undefined,
  containing: (id: string, version: string) => readonly string[],
): EvidenceRecord[] =>
  records
    .filter((record) => recordHoldsIn(record, view))
    .map((record) => ({ ...record, baselines: [...containing(record.element, record.version)] }));
