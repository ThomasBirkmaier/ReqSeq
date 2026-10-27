// The evidence index (ADR-0012 "Block and state"): the records of the workspace by element and the
// test cases they form. Pure: it does not look at the element store, so whether a record's element
// exists, which version is current and which status follows is up to the consumers (status,
// coverage, list, chain, matrix).
import type { View } from "../variants/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { EvidenceRecord, SkippedTestCase, TestCase } from "./record.js";
import { testCaseKey } from "./record.js";
import { evidenceReadState, evidenceRecordsState } from "./state.js";

/** One test case across all its files and elements (internal form of `$defs/testCase`). */
export interface TestCaseEntry {
  /** `testCaseKey` of its name and class name. */
  readonly key: string;
  readonly name: string;
  readonly className?: string;
  /** Every element it names, each once: from its records newest first, then from its skipped appearances in their order. */
  readonly elements: readonly string[];
  /** Its records of every element, newest first (`newestFirst`). */
  readonly records: readonly EvidenceRecord[];
  /** Its records of each element (by UUID), newest first: the `executions` of `testCasesOf`. */
  readonly recordsOf: ReadonlyMap<string, readonly EvidenceRecord[]>;
}

/** The records of a workspace by element and test case. */
export interface EvidenceIndex {
  /** The records of each element (by UUID), newest first (`newestFirst`). */
  readonly byElement: ReadonlyMap<string, readonly EvidenceRecord[]>;
  /** Every test case by `testCaseKey`, in the order of `testCasesOf`. */
  readonly testCases: ReadonlyMap<string, TestCaseEntry>;
  /**
   * The test cases that name the element `id`, each seen from it (`$defs/testCase`): `executions`
   * holds its records only, `last` the newest of them, `executed` is false when it has none (only
   * skipped appearances, SR-033 AK3). Ordered by class name, then name (code units). Built once
   * per element and kept: a second call gives the same array.
   */
  readonly testCasesOf: (id: string) => readonly TestCase[];
}

/**
 * `date` as an instant; a date that cannot be read counts as the oldest. The one reading of "newer"
 * for the index order, the status (SR-031) and the outdated hint (SR-025 AK4).
 */
export const instantOf = (date: string): number => {
  const time = Date.parse(date);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/** Code unit order, the same on every OS. */
const byCodeUnits = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** Compares two records of one date and keeps one order on every machine: repository, file, line. */
const byLocation = (a: EvidenceRecord, b: EvidenceRecord): number =>
  byCodeUnits(a.repository ?? "", b.repository ?? "") ||
  byCodeUnits(a.file ?? "", b.file ?? "") ||
  (a.line ?? 0) - (b.line ?? 0);

/**
 * The order of records everywhere in the block: newest `date` first (compared as instants), then by
 * repository, file and line. For one comparison; `sortNewestFirst` sorts a list.
 */
export const newestFirst = (a: EvidenceRecord, b: EvidenceRecord): number =>
  instantOf(b.date) - instantOf(a.date) || byLocation(a, b);

/** `records` sorted by `newestFirst`, each date parsed once. */
export const sortNewestFirst = (records: readonly EvidenceRecord[]): EvidenceRecord[] =>
  records
    .map((record) => ({ record, time: instantOf(record.date) }))
    .sort((a, b) => b.time - a.time || byLocation(a.record, b.record))
    .map(({ record }) => record);

/** Each value once, in first-seen order. */
const unique = (values: Iterable<string>): string[] => [...new Set(values)];

/** The index of `records` and the skipped test cases `skipped` (see `EvidenceIndex`). */
export const evidenceIndex = (
  records: readonly EvidenceRecord[],
  skipped: readonly SkippedTestCase[] = [],
): EvidenceIndex => {
  const sorted = sortNewestFirst(records);
  const byElement = new Map<string, EvidenceRecord[]>();
  interface Group {
    readonly name: string;
    readonly className: string | undefined;
    readonly records: EvidenceRecord[];
    readonly recordsOf: Map<string, EvidenceRecord[]>;
    readonly named: string[];
  }
  const grouped = new Map<string, Group>();
  const group = (name: string, className: string | undefined): Group => {
    const key = testCaseKey(name, className);
    const entry = grouped.get(key) ?? { name, className, records: [], recordsOf: new Map(), named: [] };
    grouped.set(key, entry);
    return entry;
  };
  for (const record of sorted) {
    const own = byElement.get(record.element) ?? [];
    own.push(record);
    byElement.set(record.element, own);
    if (record.testCase !== undefined) {
      const entry = group(record.testCase, record.className);
      entry.records.push(record);
      const ofElement = entry.recordsOf.get(record.element) ?? [];
      ofElement.push(record);
      entry.recordsOf.set(record.element, ofElement);
      entry.named.push(record.element);
    }
  }
  for (const test of skipped) {
    group(test.name, test.className).named.push(...test.elements);
  }
  const entries: TestCaseEntry[] = [...grouped].map(([key, entry]) => ({
    key,
    name: entry.name,
    ...(entry.className === undefined ? {} : { className: entry.className }),
    elements: unique(entry.named),
    records: entry.records,
    recordsOf: entry.recordsOf,
  }));
  entries.sort((a, b) => byCodeUnits(a.className ?? "", b.className ?? "") || byCodeUnits(a.name, b.name));
  const testCases = new Map(entries.map((e) => [e.key, e]));
  const ofElement = new Map<string, TestCaseEntry[]>();
  for (const entry of entries) {
    for (const id of entry.elements) {
      const of = ofElement.get(id) ?? [];
      of.push(entry);
      ofElement.set(id, of);
    }
  }
  const shown = new Map<string, readonly TestCase[]>();
  const testCasesOf = (id: string): readonly TestCase[] => {
    const kept = shown.get(id);
    if (kept !== undefined) {
      return kept;
    }
    const cases = (ofElement.get(id) ?? []).map((entry): TestCase => {
      const executions = entry.recordsOf.get(id) ?? [];
      const [last] = executions;
      return {
        name: entry.name,
        ...(entry.className === undefined ? {} : { className: entry.className }),
        elements: entry.elements,
        executed: last !== undefined,
        executions,
        ...(last === undefined ? {} : { last }),
      };
    });
    shown.set(id, cases);
    return cases;
  };
  return { byElement, testCases, testCasesOf };
};

/**
 * Whether the element `id` has at least one verification record in `view` (SR-069 AK3 "ohne
 * Nachweis", SR-022 AK3 `no-evidence`, SR-036 coverage; D-007 keeps validation apart): in the core
 * a record without a variant, in a variant a record for that variant (SR-047 AK1, AK2). Version and
 * result do not count here (spec question #527).
 */
export const hasVerificationRecord = (index: EvidenceIndex, id: string, view: View): boolean =>
  (index.byElement.get(id) ?? []).some(
    (r) => r.kind === "verification" && r.variant === (view.kind === "core" ? undefined : view.variant.id),
  );

/** The index of the workspace's records (`evidenceRecordsState`) and skipped test cases (`evidenceReadState`). */
export const evidenceIndexState = defineWorkspaceState(
  "evidence-index",
  async (workspace): Promise<EvidenceIndex> => {
    const records = await workspace.get(evidenceRecordsState);
    const { skipped } = await workspace.get(evidenceReadState);
    return evidenceIndex(records, skipped);
  },
  { dependsOn: [evidenceRecordsState, evidenceReadState] },
);
