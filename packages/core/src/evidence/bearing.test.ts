// bearingRecords (SR-032 AK3): which records of `evidence.list` bear the element's status. The
// command test (commands/evidence/list.test.ts) covers the current version of a real file.
import { describe, expect, it } from "vitest";
import type { VersionForms } from "../model/index.js";
import { bearingRecords } from "./bearing.js";
import type { EvidenceRecord } from "./record.js";

const CURRENT: VersionForms = { n1: "n1:cccccccccccccccc", n2: "n2:cccccccccccccccc" };
const OLD = "n1:0000000000000000";

const record = (date: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "verification",
  element: "e",
  version: CURRENT.n1,
  method: "test",
  item: date,
  result: "passed",
  date: `2026-10-${date}T08:00:00Z`,
  ...more,
});

describe("bearingRecords (SR-032 AK3)", () => {
  it("[SR-032/AK3] keeps per kind and variant the newest record of the current version, else the newest of an older one", () => {
    const records = [
      record("20", { version: OLD }),
      record("15"),
      record("10"),
      record("12", { variant: "v", version: OLD }),
      record("11", { variant: "v", version: OLD }),
      record("09", { kind: "validation" }),
      record("08", { kind: "validation" }),
    ];
    expect(bearingRecords(records, CURRENT, 0)).toEqual([1, 3, 5]);
    // Without a known current version every record is of an older version.
    expect(bearingRecords(records, undefined, 0)).toEqual([0, 3, 5]);
    expect(bearingRecords([], CURRENT, 3)).toEqual([]);
  });

  it("[SR-032/AK3] keeps every record that shares the newest date, the whole run; an inconclusive verification is of no current version", () => {
    const records = [
      record("20", { result: "inconclusive" }),
      record("15"),
      record("15", { result: "failed" }),
      record("15"),
      record("01"),
    ];
    expect(bearingRecords(records, CURRENT, 0)).toEqual([1, 2, 3]);
    // Validation alike: every newest one.
    const validation = (result: EvidenceRecord["result"]): EvidenceRecord =>
      record("15", { kind: "validation", result });
    expect(bearingRecords([validation("passed"), validation("inconclusive")], CURRENT, 0)).toEqual([0, 1]);
    // Per criterion: AK1 only the second; AK2 both.
    expect(
      bearingRecords([record("15", { criteria: [2] }), record("15", { criteria: [1, 2] })], CURRENT, 2),
    ).toEqual([0, 1]);
  });

  it("keeps the newest per acceptance criterion, a record without criteria counting for each (D-072, SR-031 AK6)", () => {
    const records = [
      record("20", { criteria: [1] }),
      record("18", { criteria: [2, 9] }),
      record("15"),
      record("12", { criteria: [1, 2] }),
      record("10", { criteria: [9] }),
      // Validation records have no status per criterion: the newest of them alone.
      record("09", { kind: "validation", criteria: [1] }),
      record("08", { kind: "validation" }),
    ];
    // AK1: the record of the 20th; AK2: of the 18th; AK3: only the one without criteria; 9 is beyond the count.
    expect(bearingRecords(records, CURRENT, 3)).toEqual([0, 1, 2, 5]);
    // A criterion no record counts for has none.
    expect(bearingRecords([record("20", { criteria: [1] })], CURRENT, 2)).toEqual([0]);
  });

  it("pools a variant's verification records with those without variant in a variant-independent repository (SR-173)", () => {
    // The core record is newer than the coast's, so it bears the coast's status too.
    const records = [record("20"), record("10", { variant: "coast" }), record("09", { kind: "validation" })];
    expect(bearingRecords(records, CURRENT, 0, true)).toEqual([0, 2]);
    expect(bearingRecords(records, CURRENT, 0)).toEqual([0, 1, 2]);
    // Per criterion too; a variant record newer than the core's bears it.
    const newer = [record("10"), record("20", { variant: "coast" })];
    expect(bearingRecords(newer, CURRENT, 2, true)).toEqual([0, 1]);
  });
});
