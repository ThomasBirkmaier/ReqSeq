// The evidence index (ADR-0012 "Block and state"): the records of the workspace by element and the
// test cases they form. Pure: it does not look at the element store, so whether a record's element
// exists, which version is current and which status follows is up to the consumers (status,
// coverage, list, chain, matrix).
import type { View } from "../variants/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { EvidenceRecord, SkippedTestCase, TestCase } from "./record.js";
import { testCaseKey, testCaseKeyOf } from "./record.js";
import type { EvidenceRead } from "./state.js";
import { evidenceReadState, evidenceRecordsState, insertionOf } from "./state.js";

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
  /**
   * The position of `record` in the records the index was built from (`evidenceRecordsState`: the
   * walk order of the evidence locations, then path), -1 for a record that is not among them. The
   * outdated hint of one element (SR-025 AK4, `hints/evidence.ts`) puts the element's records back
   * into this order, since on a tie of dates the first record decides there, as in
   * `workspace.check`. Built on first use (one map over all records) and kept.
   */
  readonly positionOf: (record: EvidenceRecord) => number;
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

/** The order of `testCases`: class name, then name (code units). */
const byName = (a: TestCaseEntry, b: TestCaseEntry): number =>
  byCodeUnits(a.className ?? "", b.className ?? "") || byCodeUnits(a.name, b.name);

/** A test case from its records (newest first) and the elements its skipped appearances name. */
const entryOf = (
  key: string,
  name: string,
  className: string | undefined,
  records: readonly EvidenceRecord[],
  skippedNamed: readonly string[],
): TestCaseEntry => {
  const recordsOf = new Map<string, EvidenceRecord[]>();
  for (const record of records) {
    const ofElement = recordsOf.get(record.element) ?? [];
    ofElement.push(record);
    recordsOf.set(record.element, ofElement);
  }
  return {
    key,
    name,
    ...(className === undefined ? {} : { className }),
    elements: unique([...records.map((r) => r.element), ...skippedNamed]),
    records,
    recordsOf,
  };
};

/** What an index keeps besides its fields, so that `evidenceIndexWith` can carry it. */
interface IndexParts {
  /** The test cases of each element, in the order of `testCases`. */
  readonly ofElement: ReadonlyMap<string, readonly TestCaseEntry[]>;
  /** What `testCasesOf` gave so far. */
  readonly shown: Map<string, readonly TestCase[]>;
}

const partsOf = new WeakMap<EvidenceIndex, IndexParts>();

/** The index of its parts; `records` is the array it is built from (`positionOf`). */
const assembled = (
  byElement: ReadonlyMap<string, readonly EvidenceRecord[]>,
  testCases: ReadonlyMap<string, TestCaseEntry>,
  parts: IndexParts,
  records: readonly EvidenceRecord[],
): EvidenceIndex => {
  const { ofElement, shown } = parts;
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
  let positions: Map<EvidenceRecord, number> | undefined;
  const positionOf = (record: EvidenceRecord): number => {
    positions ??= new Map(records.map((r, i) => [r, i]));
    return positions.get(record) ?? -1;
  };
  const index: EvidenceIndex = { byElement, testCases, testCasesOf, positionOf };
  partsOf.set(index, parts);
  return index;
};

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
    readonly skippedNamed: string[];
  }
  const grouped = new Map<string, Group>();
  const group = (name: string, className: string | undefined): Group => {
    const key = testCaseKey(name, className);
    const entry = grouped.get(key) ?? { name, className, records: [], skippedNamed: [] };
    grouped.set(key, entry);
    return entry;
  };
  for (const record of sorted) {
    const own = byElement.get(record.element) ?? [];
    own.push(record);
    byElement.set(record.element, own);
    if (record.testCase !== undefined) {
      group(record.testCase, record.className).records.push(record);
    }
  }
  for (const test of skipped) {
    group(test.name, test.className).skippedNamed.push(...test.elements);
  }
  const entries = [...grouped].map(([key, g]) =>
    entryOf(key, g.name, g.className, g.records, g.skippedNamed),
  );
  entries.sort(byName);
  const testCases = new Map(entries.map((e) => [e.key, e]));
  const ofElement = new Map<string, TestCaseEntry[]>();
  for (const entry of entries) {
    for (const id of entry.elements) {
      const of = ofElement.get(id) ?? [];
      of.push(entry);
      ofElement.set(id, of);
    }
  }
  return assembled(byElement, testCases, { ofElement, shown: new Map() }, records);
};

/**
 * `list` (newest first) with `record` at its `newestFirst` place; on a full tie (the same instant
 * and place) after the records that come before it in `records` (`positionOf`), as the stable sort
 * of `evidenceIndex` puts it.
 */
const inserted = (
  list: readonly EvidenceRecord[],
  record: EvidenceRecord,
  positionOf: (record: EvidenceRecord) => number,
): EvidenceRecord[] => {
  const at = list.findIndex((r) => {
    const order = newestFirst(record, r);
    return order < 0 || (order === 0 && positionOf(r) > positionOf(record));
  });
  const copy = [...list];
  copy.splice(at === -1 ? copy.length : at, 0, record);
  return copy;
};

/**
 * The index of `records` and `skipped` when they are the records and skipped test cases of `index`
 * with one record more, `record` (the read after `evidence.record`, `withRecord`; #278): equal to
 * `evidenceIndex(records, skipped)`, built from `index` without sorting all records again. The
 * element's list gets `record` at its place (a copy; every other list is the same array), and when
 * it names a test case, that test case is built again (or added in its order), with the test cases
 * of its elements; `positionOf` counts in `records`, so every record after `record` moves by one
 * (review N2 of #708). `index` is not changed.
 */
export const evidenceIndexWith = (
  index: EvidenceIndex,
  record: EvidenceRecord,
  records: readonly EvidenceRecord[],
  skipped: readonly SkippedTestCase[],
): EvidenceIndex => {
  const parts = partsOf.get(index);
  if (parts === undefined) {
    return evidenceIndex(records, skipped);
  }
  // Asked only on a full tie of instant and place (records without a place), so rarely.
  const positionIn = (r: EvidenceRecord): number => records.indexOf(r);
  const byElement = new Map(index.byElement);
  byElement.set(record.element, inserted(index.byElement.get(record.element) ?? [], record, positionIn));
  const key = testCaseKeyOf(record);
  if (key === undefined || record.testCase === undefined) {
    // The test cases are those of `index`; their cache is shared, its values are the same.
    return assembled(byElement, index.testCases, parts, records);
  }
  const before = index.testCases.get(key);
  const skippedNamed = skipped
    .filter((test) => testCaseKey(test.name, test.className) === key)
    .flatMap((test) => test.elements);
  const entry = entryOf(
    key,
    before?.name ?? record.testCase,
    before === undefined ? record.className : before.className,
    inserted(before?.records ?? [], record, positionIn),
    skippedNamed,
  );
  const ordered =
    before === undefined
      ? [...index.testCases.values(), entry].sort(byName)
      : [...index.testCases.values()].map((e) => (e === before ? entry : e));
  const testCases = new Map(ordered.map((e) => [e.key, e]));
  const ofElement = new Map(parts.ofElement);
  const shown = new Map(parts.shown);
  for (const id of entry.elements) {
    const of = (parts.ofElement.get(id) ?? []).filter((e) => e !== before);
    of.push(entry);
    of.sort(byName);
    ofElement.set(id, of);
    shown.delete(id);
  }
  return assembled(byElement, testCases, { ofElement, shown }, records);
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

/**
 * The index of the workspace's records (`evidenceRecordsState`) and skipped test cases
 * (`evidenceReadState`). Carried over the read after `evidence.record` (`insertionOf`,
 * `evidenceIndexWith`, #278); reset by any other change of the read or of the records.
 */
export const evidenceIndexState = defineWorkspaceState(
  "evidence-index",
  async (workspace): Promise<EvidenceIndex> => {
    const records = await workspace.get(evidenceRecordsState);
    const { skipped } = await workspace.get(evidenceReadState);
    return evidenceIndex(records, skipped);
  },
  {
    dependsOn: [evidenceRecordsState, evidenceReadState],
    carry: (value, change) => {
      const record = insertionOf(change);
      if (record === undefined) {
        return undefined;
      }
      // The new read as the change gives it, never what the workspace holds later (review B5).
      const read = change.to as Promise<EvidenceRead>;
      return Promise.all([value, read]).then(([index, now]) =>
        evidenceIndexWith(index, record, now.records, now.skipped),
      );
    },
  },
);
