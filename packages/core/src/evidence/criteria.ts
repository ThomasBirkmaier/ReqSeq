// The acceptance criteria of an element as the verification status counts them (D-072, SR-028 AK4,
// SR-031 AK11, AK12, SR-204 AK10, SR-205 AK2): the items of its current version, and for each record
// the current criteria its `criteria` count for (`resolveCriterionRefs`). A record of an older version
// that names a number counts through the key its criterion had in the newest commit with that version
// (`OlderCriteria`, `older-criteria.ts`); without Git that number counts for none (product owner
// decision, 2026-11-11, #1502). Every status path (`status.ts`, `display.ts`, `baseline.ts`,
// `hints/evidence.ts`) resolves through this file, so they agree (SR-080 AK2).
import type { DataExportCriterionName } from "../generated/types.js";
import type { ResolvedCriterion, VersionForms } from "../model/index.js";
import { criterionKey, criterionText, resolveCriterionRefs, sameVersion } from "../model/index.js";
export { criterionLabel } from "../model/criterion-items.js";
import type { EvidenceRecord } from "./record.js";

/**
 * The items of the acceptance criteria of an element's older version, those of the newest commit
 * with that version, by UUID and version; undefined where Git cannot tell or nobody asked.
 */
export type OlderCriteria = (id: string, version: string) => readonly unknown[] | undefined;

/** No older version is known (no Git, or nothing to look up). */
export const NO_OLDER_CRITERIA: OlderCriteria = () => undefined;

/** The acceptance criteria of one element as the status counts them (see the file comment). */
export interface ElementCriteria {
  /** The items of the current version (the element file). */
  readonly items: readonly unknown[];
  /** How many there are. */
  readonly count: number;
  /**
   * The current positions (from 1) the `criteria` of `record` count for, ascending and each once;
   * undefined when it names none, so it counts for every criterion (SR-031 AK6). `current` is the
   * element's current version: a record of another version is an older one.
   */
  readonly positionsOf: (
    record: EvidenceRecord,
    current: VersionForms | undefined,
  ) => readonly number[] | undefined;
  /** Each criterion `record` names, resolved (`resolveCriterionRefs`); undefined when it names none. */
  readonly resolve: (
    record: EvidenceRecord,
    current: VersionForms | undefined,
  ) => readonly ResolvedCriterion[] | undefined;
  /** The items of the version `record` names: the current ones, or those of the older version. */
  readonly namedItems: (
    record: EvidenceRecord,
    current: VersionForms | undefined,
  ) => readonly unknown[] | undefined;
}

const isCurrentRecord = (record: EvidenceRecord, current: VersionForms | undefined): boolean =>
  current !== undefined && sameVersion(record.version, current);

/** The criteria of the element `id` with the current items `items` (see the file comment). */
export const elementCriteria = (
  id: string,
  items: readonly unknown[],
  older: OlderCriteria = NO_OLDER_CRITERIA,
): ElementCriteria => {
  const count = items.length;
  // The positions of each record that takes the slow path, resolved once per current version (a
  // status asks per criterion and per view).
  const resolved = new WeakMap<
    EvidenceRecord,
    { readonly current: VersionForms | undefined; readonly positions: readonly number[] }
  >();
  const namedItems = (
    record: EvidenceRecord,
    current: VersionForms | undefined,
  ): readonly unknown[] | undefined => (isCurrentRecord(record, current) ? items : older(id, record.version));
  const resolve = (
    record: EvidenceRecord,
    current: VersionForms | undefined,
  ): readonly ResolvedCriterion[] | undefined =>
    record.criteria === undefined
      ? undefined
      : resolveCriterionRefs(record.criteria, namedItems(record, current), items);
  return {
    items,
    count,
    namedItems,
    resolve,
    positionsOf: (record, current) => {
      const refs = record.criteria;
      if (refs === undefined) {
        return undefined;
      }
      // The common case: numbers of the current version, ascending (the readers sort them).
      if (isCurrentRecord(record, current) && refs.every((r) => typeof r === "number" && r <= count)) {
        return refs as readonly number[];
      }
      const known = resolved.get(record);
      if (known !== undefined && known.current === current) {
        return known.positions;
      }
      const set = new Set<number>();
      for (const one of resolveCriterionRefs(refs, namedItems(record, current), items)) {
        if ("position" in one) {
          set.add(one.position);
        }
      }
      const positions = [...set].sort((a, b) => a - b);
      resolved.set(record, { current, positions });
      return positions;
    },
  };
};

/** Criteria without keys and texts, by count: the status rule alone (tests, a version without its items). */
const plain = new Map<number, ElementCriteria>();

/** `count` criteria without key and text (see `plain`); one object per count. */
export const plainCriteria = (count: number): ElementCriteria => {
  const known = plain.get(count);
  if (known !== undefined) {
    return known;
  }
  const criteria = elementCriteria("", Object.freeze(new Array<unknown>(count).fill(null)));
  plain.set(count, criteria);
  return criteria;
};

/** `criteria` as given, or `plainCriteria` of a count. */
export const criteriaFrom = (criteria: ElementCriteria | number): ElementCriteria =>
  typeof criteria === "number" ? plainCriteria(criteria) : criteria;

/**
 * The criterion at `position` (from 1) of `items` as an output names it (SR-205 AK2): its number, its
 * key and its text, each where it has one.
 */
export const criterionNameAt = (items: readonly unknown[], position: number): DataExportCriterionName => {
  const item = items[position - 1];
  const key = criterionKey(item);
  const text = criterionText(item);
  return {
    criterion: position,
    ...(key === undefined ? {} : { key }),
    ...(typeof text === "string" ? { text } : {}),
  };
};

/**
 * A criterion a record names, as an output names it (SR-205 AK2): with the number of the current
 * version, whose criteria are counted, its key and text when it resolves there; a key the current
 * version lacks without number, with the text of the version the record names where it is known; a
 * number of that version whose criterion has no key with that number and that version's text.
 */
export const namedCriterion = (
  resolved: ResolvedCriterion,
  current: readonly unknown[],
  named: readonly unknown[] | undefined,
): DataExportCriterionName => {
  if ("position" in resolved) {
    return criterionNameAt(current, resolved.position);
  }
  if (typeof resolved.ref === "number") {
    const item = named?.[resolved.ref - 1];
    const key = criterionKey(item);
    const text = criterionText(item);
    // A key gone from the current version (or carried twice there), else the number as named.
    return {
      ...(key === undefined ? { criterion: resolved.ref } : { key }),
      ...(typeof text === "string" ? { text } : {}),
    };
  }
  const index = named?.findIndex((item) => criterionKey(item) === resolved.ref) ?? -1;
  const text = index < 0 ? undefined : criterionText(named?.[index]);
  return { key: resolved.ref, ...(typeof text === "string" ? { text } : {}) };
};

/** The items of the older versions a lookup did not give, by version. */
export interface FetchedItems {
  readonly get: (version: string) => readonly unknown[] | undefined;
}

const NOTHING_FETCHED: FetchedItems = new Map();

/**
 * `record` with `criterionNames`: each criterion it names with number, key and text (`namedCriterion`),
 * the number that of `current`, the version whose criteria `criteria` counts; `fetched` gives the
 * items of the older versions `criteria` does not know. Unchanged for a record that names no criterion.
 */
export const withCriterionNames = (
  record: EvidenceRecord,
  criteria: ElementCriteria,
  current: VersionForms | undefined,
  fetched: FetchedItems = NOTHING_FETCHED,
): EvidenceRecord => {
  const resolved = criteria.resolve(record, current);
  if (resolved === undefined) {
    return record;
  }
  const named = criteria.namedItems(record, current) ?? fetched.get(record.version);
  return { ...record, criterionNames: resolved.map((r) => namedCriterion(r, criteria.items, named)) };
};
