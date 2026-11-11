// Generator of small abstract inputs for the status model (#1394): one element with 0 to 4 acceptance criteria and
// criterion keys (some missing, some carried twice), older versions with known or unknown criteria, and records of
// both kinds with dates that tie on purpose. It produces only records the reader accepts (refused ones are level 2,
// #1396). Everything here is a pure function of fast-check's random source, so a seed replays a case and shrinking
// works.
import fc from "fast-check";
import {
  CURRENT,
  type ModelCriterion,
  type ModelCriterionRef,
  type ModelElement,
  type ModelRecord,
} from "./model.js";

/** Criterion keys of the form SR-204 AK5 names; a generated element uses a subset, so the rest are unknown. */
export const KEYS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"] as const;
/** Older version ids; a record names one of them or `current`. */
export const OLDER_IDS = ["v1", "v2"] as const;
/** Offsets a date is written in; the same instant in two of them is a tie (V7). */
export const OFFSETS = ["Z", "+00:00", "+02:00", "-05:00", "+05:30"] as const;
/** A date the model reads as the oldest (V8). */
export const UNREADABLE_DATE = "unreadable";
/** Highest criterion number a record names; above the criteria count it is unknown (V12). */
export const MAX_NUMBER = 6;

const BASE = Date.UTC(2026, 10, 1, 10, 0, 0);
const HOUR = 3_600_000;

/** The date of instant `index` (hours after a fixed base) written in `offset`. Pure. */
export function renderDate(index: number, offset: (typeof OFFSETS)[number]): string {
  const instant = BASE + index * HOUR;
  if (offset === "Z") {
    return new Date(instant).toISOString().replace(".000Z", "Z");
  }
  const sign = offset.startsWith("-") ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return new Date(instant + minutes * 60_000).toISOString().replace(".000Z", offset);
}

function criteriaArbitrary(): fc.Arbitrary<ModelCriterion[]> {
  return fc
    .integer({ min: 0, max: 4 })
    .chain((count) =>
      fc.tuple(
        fc.shuffledSubarray([...KEYS], { minLength: count, maxLength: count }),
        fc.array(fc.integer({ min: 0, max: 7 }), { minLength: count, maxLength: count }),
      ),
    )
    .map(([keys, shape]) => {
      // shape 0: no key; shape 1: the key of the last criterion before it that has one, a duplicate (SR-204 AK10).
      const criteria: ModelCriterion[] = [];
      let last: string | undefined;
      keys.forEach((key, index) => {
        if (shape[index] === 0) {
          criteria.push({});
        } else if (shape[index] === 1 && last !== undefined) {
          criteria.push({ key: last });
        } else {
          criteria.push({ key });
          last = key;
        }
      });
      return criteria;
    });
}

const refArbitrary: fc.Arbitrary<ModelCriterionRef> = fc.oneof(
  fc.constantFrom(...KEYS).map((key) => ({ by: "key" as const, key })),
  fc.integer({ min: 1, max: MAX_NUMBER }).map((number) => ({ by: "number" as const, number })),
);

const dateArbitrary: fc.Arbitrary<string> = fc
  .oneof(
    { weight: 12, arbitrary: fc.tuple(fc.integer({ min: 0, max: 3 }), fc.constantFrom(...OFFSETS)) },
    { weight: 1, arbitrary: fc.constant(UNREADABLE_DATE) },
  )
  .map((date) => (typeof date === "string" ? date : renderDate(date[0], date[1])));

function recordArbitrary(versions: readonly string[]): fc.Arbitrary<ModelRecord> {
  return fc
    .record({
      kind: fc.constantFrom("verification" as const, "validation" as const),
      version: fc.constantFrom(...versions),
      date: dateArbitrary,
      outcome: fc.integer({ min: 0, max: 3 }),
      reason: fc.constantFrom("reason one", "reason two"),
      criteria: fc.option(fc.array(refArbitrary, { minLength: 1, maxLength: 3 }), {
        nil: undefined,
        freq: 3,
      }),
    })
    .map(({ kind, version, date, outcome, reason, criteria }) => {
      const result =
        outcome === 3 && kind === "validation" ? "inconclusive" : outcome % 2 === 0 ? "passed" : "failed";
      return {
        kind,
        version,
        date,
        result,
        ...(result === "inconclusive" ? { reason } : {}),
        ...(criteria === undefined ? {} : { criteria }),
      };
    });
}

/** One element with its criteria, older versions and own records, in one view. */
export function statusModelElement(): fc.Arbitrary<ModelElement> {
  return fc
    .record({
      criteria: criteriaArbitrary(),
      olderCount: fc.integer({ min: 0, max: OLDER_IDS.length }),
      olderCriteria: fc.array(fc.option(criteriaArbitrary(), { nil: undefined, freq: 4 }), {
        minLength: OLDER_IDS.length,
        maxLength: OLDER_IDS.length,
      }),
    })
    .chain(({ criteria, olderCount, olderCriteria }) => {
      const olderVersions = OLDER_IDS.slice(0, olderCount).map((id, index) => {
        const known = olderCriteria[index];
        return known === undefined ? { id } : { id, criteria: known };
      });
      const versions = [CURRENT, ...olderVersions.map((version) => version.id)];
      return fc
        .array(recordArbitrary(versions), { maxLength: 6 })
        .map((records) => ({ criteria, olderVersions, records }));
    });
}
