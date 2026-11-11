// The records that bear an element's status (SR-032 AK3): of the records `evidence.list` lists, those
// the app shows open, the rest it folds away. Per kind, variant and acceptance criterion (D-072): the
// newest records of the current version (`ofVersion`, the records the status rule of `status.ts`
// decides by), or, when none is of it, the newest of an older version. A record without `criteria`
// counts for every criterion (SR-031 AK6), one that names criteria for the current criteria they
// resolve to by key or number (`ElementCriteria.positionsOf`, as the status); with `count` 0 (AK7) and for validation records, which
// have no status per criterion, all records of the kind and variant form one group. Every record with
// the newest date bears its group (a CI run dates all its test cases alike, so the whole run stays
// open; SR-032 AK3 as of 2026-11-09); the status still follows `status.ts`. In a repository
// marked `variant-independent` (SR-173) a variant's verification records are pooled with those without
// variant, as its status pools them (`holdsIn`). Pure.
import type { VersionForms } from "../model/index.js";
import { instantOf } from "./by-element.js";
import type { ElementCriteria } from "./criteria.js";
import { criteriaFrom } from "./criteria.js";
import type { EvidenceRecord } from "./record.js";
import { ofVersion } from "./status.js";

/** A record with its position in the list and its date as an instant. */
interface Placed {
  readonly record: EvidenceRecord;
  readonly at: number;
  readonly time: number;
}

/** Marks in `bearing` the positions of the records of `group` that bear their status (file comment). */
const markNewest = (
  group: readonly Placed[],
  current: VersionForms | undefined,
  bearing: Set<number>,
): void => {
  const deciding = group.filter(({ record }) => ofVersion(record, record.kind, current));
  const from = deciding.length > 0 ? deciding : group;
  const newest = from.reduce((max, { time }) => Math.max(max, time), Number.NEGATIVE_INFINITY);
  for (const placed of from) {
    if (placed.time === newest) {
      bearing.add(placed.at);
    }
  }
};

/**
 * The positions in `records` (ascending) of the records that bear the status of their element (see
 * the file comment), measured against its `current` version with its acceptance `criteria` (a count:
 * criteria without keys);
 * `independent`: the element's repository is marked `variant-independent` (SR-173).
 * O(records × (count + 1)).
 */
export const bearingRecords = (
  records: readonly EvidenceRecord[],
  current: VersionForms | undefined,
  of: ElementCriteria | number,
  independent = false,
): number[] => {
  const criteria = criteriaFrom(of);
  const { count } = criteria;
  const groups = new Map<string, Placed[]>();
  records.forEach((record, at) => {
    const key = `${record.kind}\u0000${record.variant ?? ""}`;
    const group = groups.get(key) ?? [];
    groups.set(key, group);
    group.push({ record, at, time: instantOf(record.date) });
  });
  const core = groups.get("verification\u0000") ?? [];
  const bearing = new Set<number>();
  for (const [key, own] of groups) {
    const verification = key.startsWith("verification\u0000");
    const group = independent && verification && own !== core ? [...own, ...core] : own;
    // Validation records have no status per criterion; without criteria the group is the requirement.
    if (count === 0 || !verification) {
      markNewest(group, current, bearing);
      continue;
    }
    for (let n = 1; n <= count; n += 1) {
      markNewest(
        group.filter(({ record }) => criteria.positionsOf(record, current)?.includes(n) ?? true),
        current,
        bearing,
      );
    }
  }
  return [...bearing].sort((a, b) => a - b);
};
