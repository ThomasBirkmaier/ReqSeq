// The evidence index carried over one more record (#278, plan §3.4): `evidenceIndexWith(index, r,
// records, skipped)` must equal `evidenceIndex(records, skipped)` for the records with `r` at its
// walk position, whatever `r` is: with or without a test case, of a test case that exists or a new
// one, on a tie of dates, next to skipped appearances. Seeded random records; `positionOf` counts in
// the new records (review N2 of #708). The old index is not changed.
import { describe, expect, it } from "vitest";
import type { EvidenceIndex } from "./by-element.js";
import { evidenceIndex, evidenceIndexWith } from "./by-element.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";

const P = "5e535a7d-2b4f-4c61-9d08-0";
const ELEMENTS = [1, 2, 3, 4, 5].map((n) => `${P}a000000000${String(n)}`);
const DATES = ["2026-01-01T10:00:00Z", "2026-01-02T10:00:00Z", "2026-01-02T10:00:00+00:00", "not a date"];
const CASES = ["wind", "rain", "sun"];

/** A small seeded random generator (mulberry32). */
const randomOf = (seed: number) => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  return { next, pick };
};
type Random = ReturnType<typeof randomOf>;

let line = 0;
const recordOf = (random: Random): EvidenceRecord => {
  line += 1;
  const named = random.next() < 0.6;
  return {
    element: random.pick(ELEMENTS),
    version: "n1:1111111111111111",
    kind: random.next() < 0.8 ? "verification" : "validation",
    method: "test",
    item: "build-1",
    result: random.next() < 0.8 ? "passed" : "failed",
    date: random.pick(DATES),
    ...(random.next() < 0.3 ? { variant: random.pick(ELEMENTS) } : {}),
    ...(named
      ? { testCase: random.pick(CASES), ...(random.next() < 0.5 ? { className: "tests.Wind" } : {}) }
      : {}),
    // Some without a place (injected records), so ties of place happen too.
    ...(random.next() < 0.8
      ? { repository: random.pick(["ci", "system"]), file: random.pick(["a", "b"]), line }
      : {}),
  };
};

const skippedOf = (random: Random): SkippedTestCase[] =>
  CASES.filter(() => random.next() < 0.5).map((name, i) => ({
    name,
    ...(random.next() < 0.5 ? { className: "tests.Wind" } : {}),
    elements: [random.pick(ELEMENTS), random.pick(ELEMENTS)].filter((e, j, all) => all.indexOf(e) === j),
    repository: "ci",
    file: "junit.xml",
    line: i + 1,
  }));

/** Everything an index tells, with `records` its records in order. */
const seen = (index: EvidenceIndex, records: readonly EvidenceRecord[]) => ({
  // The keys in any order (only `get` and `has` are used); each list in its order.
  byElement: [...index.byElement].sort(([a], [b]) => a.localeCompare(b)),
  testCases: [...index.testCases],
  testCasesOf: ELEMENTS.map((id) => index.testCasesOf(id)),
  positions: records.map((r) => index.positionOf(r)),
});

describe("evidenceIndexWith (#278)", () => {
  it("equals the index built from the records with one more, for seeded random records", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = randomOf(seed);
      const skipped = skippedOf(random);
      let records: EvidenceRecord[] = Array.from({ length: Math.floor(random.next() * 12) }, () =>
        recordOf(random),
      );
      let index = evidenceIndex(records, skipped);
      // Some test cases seen before the carry, so their cache must be dropped where it changes.
      for (const id of ELEMENTS.slice(0, 3)) {
        index.testCasesOf(id);
      }
      for (let step = 0; step < 6; step += 1) {
        const before = seen(index, records);
        const added = recordOf(random);
        const at = Math.floor(random.next() * (records.length + 1));
        const next = [...records.slice(0, at), added, ...records.slice(at)];
        const carried = evidenceIndexWith(index, added, next, skipped);
        expect(seen(carried, next), `seed ${String(seed)} step ${String(step)}`).toEqual(
          seen(evidenceIndex(next, skipped), next),
        );
        // The old index is as it was.
        expect(seen(index, records)).toEqual(before);
        expect(index.positionOf(added)).toBe(-1);
        records = next;
        index = carried;
      }
    }
  });

  it("builds the index anew from an index of another origin", () => {
    const random = randomOf(7);
    const records = [recordOf(random), recordOf(random)];
    const foreign: EvidenceIndex = {
      byElement: new Map(),
      testCases: new Map(),
      testCasesOf: () => [],
      positionOf: () => -1,
    };
    const added = recordOf(random);
    const next = [...records, added];
    expect(seen(evidenceIndexWith(foreign, added, next, []), next)).toEqual(
      seen(evidenceIndex(next, []), next),
    );
  });
});
