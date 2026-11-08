// The records that bear an element's status (SR-032 AK3): of the records `evidence.list` lists, those
// the app shows open, the rest it folds away. Per kind, variant and acceptance criterion (D-072): the
// newest records of the current version (`ofVersion`, the records the status rule of `status.ts`
// decides by), or, when none is of it, the newest of an older version. A record without `criteria`
// counts for every criterion (SR-031 AK6), one that names criteria for those it names up to `count`
// (a larger number for none, as the status); with `count` 0 (AK7) and for validation records, which
// have no status per criterion, all records of the kind and variant form one group. One record bears
// each group: when several share the newest date (a CI run dates all its test cases alike), the one the
// status follows, a failed before an inconclusive before a passed one (the tie rule of `status.ts`),
// then one that already bears another group, then the first in the list (core's order). Pure.
import type { VersionForms } from "../model/index.js";
import { instantOf } from "./by-element.js";
import type { EvidenceRecord } from "./record.js";
import { ofVersion } from "./status.js";

/** How a result wins a tie at the newest date (`status.ts`): lower first. */
const RANK: Readonly<Record<EvidenceRecord["result"], number>> = { failed: 0, inconclusive: 1, passed: 2 };

/** A record with its position in the list. */
interface Placed {
  readonly record: EvidenceRecord;
  readonly at: number;
}

/** Marks in `bearing` the position of the record of `group` that bears their status (file comment). */
const markNewest = (
  group: readonly Placed[],
  current: VersionForms | undefined,
  bearing: Set<number>,
): void => {
  const deciding = group.filter(({ record }) => ofVersion(record, record.kind, current));
  const from = deciding.length > 0 ? deciding : group;
  const newest = from.reduce(
    (max, { record }) => Math.max(max, instantOf(record.date)),
    Number.NEGATIVE_INFINITY,
  );
  // Lower first; `from` ascends, so the first of equal ones is the first in the list.
  const order = ({ record, at }: Placed): number => RANK[record.result] * 2 + (bearing.has(at) ? 0 : 1);
  let best: Placed | undefined;
  for (const placed of from) {
    if (instantOf(placed.record.date) === newest && (best === undefined || order(placed) < order(best))) {
      best = placed;
    }
  }
  if (best !== undefined) {
    bearing.add(best.at);
  }
};

/**
 * The positions in `records` (ascending) of the records that bear the status of their element (see
 * the file comment), measured against its `current` version with `count` acceptance criteria.
 * O(records × (count + 1)).
 */
export const bearingRecords = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
  count: number,
): number[] => {
  const groups = new Map<string, Placed[]>();
  records.forEach((record, at) => {
    const key = `${record.kind}\u0000${record.variant ?? ""}`;
    const group = groups.get(key) ?? [];
    groups.set(key, group);
    group.push({ record, at });
  });
  const bearing = new Set<number>();
  for (const group of groups.values()) {
    // Validation records have no status per criterion; without criteria the group is the requirement.
    if (count === 0 || group.some(({ record }) => record.kind !== "verification")) {
      markNewest(group, current, bearing);
      continue;
    }
    for (let n = 1; n <= count; n += 1) {
      markNewest(
        group.filter(({ record }) => record.criteria === undefined || record.criteria.includes(n)),
        current,
        bearing,
      );
    }
  }
  return [...bearing].sort((a, b) => a - b);
};
