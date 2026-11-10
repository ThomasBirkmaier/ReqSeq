// The Evidence section of an element at a glance (SR-032 AK3 to AK5): `display` of `evidence.list`,
// so the app only lays it out (ADR-0002) and every access gives the same (SR-080). From the records
// the command lists and the positions that bear the status (`bearingRecords`):
// - `shared` (AK5): each of date, item, version and baselines that every record of the rows has, equal
//   (the date as an instant, shown as the first record writes it; baselines as an ordered list).
// - `rows` (AK4): with a verification record, one row per acceptance criterion 1..count, or one for
//   the whole requirement without criteria; its status in each view the element applies in comes from
//   `criterionStatusesOf`, the rule of the status itself (SR-031, SR-047, SR-173), so the row agrees
//   with `evidence.status`, and the row's status is the worst of them. A criterion without record has
//   a row too, open and without cases. With a validation record, one validation row with the validation
//   status (SR-038, core only, D-026). The cases of a row are its bearing records (those naming its
//   criterion or none, SR-031 AK6, and holding in a view the element applies in) by test case
//   (`testCaseKeyOf`), a record without test case its own; two records of one execution in two views
//   (one JUnit test case for core and variant) are both records of the case. Order: worst result
//   first, then class name, then name, in code units; records without test case last, in their order.
// - `older` (AK3): the records no row shows by run, the same instant and version (as written: one
//   version in its two normal forms is two runs), newest first, then version. A record that names only
//   criteria beyond the count bears nothing and lands here, as does a bearing record for a view the
//   element does not apply in. Without views (no requirement) there are no verification rows.
// Pure; O(records × (count + 1) × views).
import type { EvidenceListOutput } from "../generated/types.js";
import type { VersionForms } from "../model/index.js";
import type { View } from "../variants/index.js";
import { instantOf } from "./by-element.js";
import { holdsIn } from "./holds.js";
import type { EvidenceRecord } from "./record.js";
import { testCaseKeyOf } from "./record.js";
import type { RecordVerificationStatus } from "./status.js";
import { criterionStatusesOf, validationOf } from "./status.js";

export type Display = EvidenceListOutput["display"];
type Row = Display["rows"][number];
type Case = Row["cases"][number];

/** What `displayOf` needs besides the records. */
export interface DisplayInput {
  /** The positions in `records` that bear the status (`bearingRecords`). */
  readonly bearing: readonly number[];
  readonly current: VersionForms | undefined;
  /** The element's number of acceptance criteria (0 without). */
  readonly count: number;
  /** The views the element applies in, the core first (`verificationOf`'s holders). */
  readonly views: readonly View[];
  /** Its repository is marked `variant-independent` (SR-173). */
  readonly independent: boolean;
  /** A validation record can name it (`validatesType`): no validation row otherwise (SR-038 AK5). */
  readonly validates: boolean;
}

/** A record with its position in the records of `evidence.list`. */
interface Placed {
  readonly record: EvidenceRecord;
  readonly at: number;
}

/** Worse first: a row's status is the worst of its views'. */
const STATUS_RANK: Readonly<Record<RecordVerificationStatus, number>> = {
  failed: 0,
  outdated: 1,
  open: 2,
  verified: 3,
};
const RESULT_RANK: Readonly<Record<EvidenceRecord["result"], number>> = {
  failed: 0,
  inconclusive: 1,
  passed: 2,
};

const viewName = (view: View): string => (view.kind === "core" ? "core" : view.variant.id);

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sameList = (a: readonly string[], b: readonly string[] | undefined): boolean =>
  b?.length === a.length && a.every((x, i) => x === b[i]);

/** AK5: the values every one of `records` has, equal. */
const sharedOf = (records: readonly EvidenceRecord[]): Display["shared"] => {
  const [first, ...rest] = records;
  if (first === undefined) {
    return {};
  }
  const time = instantOf(first.date);
  const { item, baselines } = first;
  return {
    ...(rest.every((r) => instantOf(r.date) === time) ? { date: first.date } : {}),
    ...(item !== undefined && rest.every((r) => r.item === item) ? { item } : {}),
    ...(rest.every((r) => r.version === first.version) ? { version: first.version } : {}),
    ...(baselines !== undefined && rest.every((r) => sameList(baselines, r.baselines))
      ? { baselines: [...baselines] }
      : {}),
  };
};

/** One case from the records of one test case (or one record without test case). */
const caseOf = (members: readonly Placed[], first: EvidenceRecord): Case & { readonly rank: number } => {
  const worst = members.reduce((a, b) =>
    RESULT_RANK[b.record.result] < RESULT_RANK[a.record.result] ? b : a,
  );
  const rank = RESULT_RANK[worst.record.result];
  const variants = [
    ...new Set(members.flatMap(({ record }) => (record.variant === undefined ? [] : [record.variant]))),
  ].sort(byCodeUnits);
  const core = members.some(({ record }) => record.variant === undefined);
  return {
    ...(first.testCase === undefined ? {} : { testCase: first.testCase }),
    ...(first.testCase === undefined || first.className === undefined ? {} : { className: first.className }),
    result: worst.record.result,
    views: core ? ["core", ...variants] : variants,
    records: members.map(({ at }) => at),
    rank,
  };
};

/** The cases of a row from its bearing records, in the order of the file comment. */
const casesOf = (placed: readonly Placed[]): Case[] => {
  const groups = new Map<string, { first: EvidenceRecord; members: Placed[] }>();
  for (const entry of placed) {
    const key = testCaseKeyOf(entry.record) ?? `\u0000${String(entry.at)}`;
    const group = groups.get(key) ?? { first: entry.record, members: [] };
    groups.set(key, group);
    group.members.push(entry);
  }
  const cases = [...groups.values()].map(({ first, members }) => caseOf(members, first));
  // The sort is stable: unnamed cases keep their order after the named ones of their rank.
  cases.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(a.testCase === undefined) - Number(b.testCase === undefined) ||
      byCodeUnits(a.className ?? "", b.className ?? "") ||
      byCodeUnits(a.testCase ?? "", b.testCase ?? ""),
  );
  return cases.map(({ rank: _rank, ...rest }) => rest);
};

/** The verification rows (AK4): one per criterion, or one without criteria. */
const verificationRows = (
  records: readonly EvidenceRecord[],
  bearing: readonly Placed[],
  input: DisplayInput,
): Row[] => {
  const { current, count, views, independent } = input;
  // The statuses per row: for each criterion, its status in each view, the views in their order.
  const perRow: { view: string; status: RecordVerificationStatus }[][] = [];
  for (const view of views) {
    for (const [i, status] of criterionStatusesOf(records, current, view, independent, count).entries()) {
      (perRow[i] ??= []).push({ view: viewName(view), status });
    }
  }
  // Only records that hold in a view the element applies in (SR-047 AK3, SR-029 AK11).
  const ofKind = bearing.filter(
    ({ record }) =>
      record.kind === "verification" && views.some((view) => holdsIn(record, view, independent)),
  );
  // `views` is not empty (`displayOf`), so there is one entry per criterion, or one without criteria.
  return perRow.map((statuses, i): Row => {
    const criterion = i + 1;
    const { status } = statuses.reduce((a, b) => (STATUS_RANK[b.status] < STATUS_RANK[a.status] ? b : a));
    const mine =
      count === 0
        ? ofKind
        : ofKind.filter(({ record }) => record.criteria === undefined || record.criteria.includes(criterion));
    return {
      kind: "verification",
      ...(count === 0 ? {} : { criterion }),
      status,
      views: statuses,
      cases: casesOf(mine),
    };
  });
};

/** The other records by run (AK3): the same instant and version, newest first, then version. */
const olderOf = (others: readonly Placed[]): Display["older"] => {
  const runs = new Map<string, { date: string; version: string; time: number; records: number[] }>();
  for (const { record, at } of others) {
    const time = instantOf(record.date);
    const key = `${String(time)}\u0000${record.version}`;
    const run = runs.get(key) ?? { date: record.date, version: record.version, time, records: [] };
    runs.set(key, run);
    run.records.push(at);
  }
  return [...runs.values()]
    .sort((a, b) => b.time - a.time || byCodeUnits(a.version, b.version))
    .map(({ date, version, records }) => ({ date, version, records }));
};

/** `display` of `evidence.list` for `records` (see the file comment). */
export const displayOf = (records: readonly EvidenceRecord[], input: DisplayInput): Display => {
  const bears = new Set(input.bearing);
  const placed = records.map((record, at): Placed => ({ record, at }));
  const bearing = placed.filter(({ at }) => bears.has(at));
  const rows: Row[] = [];
  // No verification rows without a view (an element that is no requirement, or one in no view asked).
  if (input.views.length > 0 && records.some((r) => r.kind === "verification")) {
    rows.push(...verificationRows(records, bearing, input));
  }
  if (input.validates && records.some((r) => r.kind === "validation")) {
    rows.push({
      kind: "validation",
      status: validationOf(records, input.current).status,
      cases: casesOf(bearing.filter(({ record }) => record.kind === "validation")),
    });
  }
  // A bearing record no row shows (one for a view the element does not apply in) is folded away with
  // the older ones, so every record stands somewhere (AK3), and only shown records are shared (AK5).
  const shown = new Set(rows.flatMap((row) => row.cases.flatMap((c) => c.records)));
  return {
    shared: sharedOf(placed.filter(({ at }) => shown.has(at)).map(({ record }) => record)),
    rows,
    older: olderOf(placed.filter(({ at }) => !shown.has(at))),
  };
};
