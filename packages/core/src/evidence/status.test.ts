// The verification status from records (SR-031, ADR-0012 "Status rules"), as a pure function of the
// records of one element, its current version and a view. The commands that show it (evidence.status,
// element.get) and the filter are tested in commands/evidence/status.test.ts.
import { describe, expect, it } from "vitest";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { EvidenceRecord } from "./record.js";
import { holdsIn, recordStatusOf, verificationStatusOf } from "./status.js";

const P = "5e031a7d-2b4f-4c61-9d08-0";
const A = `${P}b0000000001`;
const V = `${P}c0000000001`;
const CURRENT = "n1:1111111111111111";
const OLDER = "n1:0000000000000000";
const CORE: View = { kind: "core" };
const IN_V: View = { kind: "variant", variant: { id: V, repository: "system" } };

const record = (
  date: string,
  result: EvidenceRecord["result"],
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  element: A,
  version: CURRENT,
  kind: "verification",
  method: "test",
  item: "build-1",
  result,
  date,
  ...more,
});

/** The status of `records` of A in the core against CURRENT, the records in the order of the index and reversed. */
const statusOf = (records: readonly EvidenceRecord[], view: View = CORE): string[] => {
  const ordered = evidenceIndex(records).byElement.get(A) ?? [];
  return [
    verificationStatusOf(ordered, CURRENT, view),
    verificationStatusOf([...ordered].reverse(), CURRENT, view),
  ];
};

describe("verificationStatusOf (SR-031)", () => {
  it("[SR-031/AK1] a requirement without records is open", () => {
    expect(verificationStatusOf([], CURRENT, CORE)).toBe("open");
    expect(verificationStatusOf([], undefined, IN_V)).toBe("open");
  });

  it("[SR-031/AK2] the newest record of the current version passed gives verified", () => {
    expect(statusOf([record("2026-01-01T10:00:00Z", "passed")])).toEqual(["verified", "verified"]);
  });

  it("[SR-031/AK2] an older failed record of the current version does not count when a newer one passed", () => {
    expect(
      statusOf([record("2026-01-01T10:00:00Z", "failed"), record("2026-01-02T10:00:00Z", "passed")]),
    ).toEqual(["verified", "verified"]);
  });

  it("[SR-031/AK3] the newest record of the current version failed gives failed", () => {
    expect(statusOf([record("2026-01-01T10:00:00Z", "failed")])).toEqual(["failed", "failed"]);
  });

  it("[SR-031/AK3] a newer failed record beats an older passed one of the current version", () => {
    expect(
      statusOf([
        record("2026-01-01T10:00:00Z", "passed"),
        record("2026-01-03T10:00:00Z", "failed"),
        record("2026-01-02T10:00:00Z", "passed"),
      ]),
    ).toEqual(["failed", "failed"]);
  });

  it("[SR-031/AK4] records only of older versions give outdated", () => {
    expect(
      statusOf([
        record("2026-01-01T10:00:00Z", "passed", { version: OLDER }),
        record("2026-01-02T10:00:00Z", "failed", { version: "n1:2222222222222222" }),
      ]),
    ).toEqual(["outdated", "outdated"]);
  });

  it("[SR-031/AK4] a record of the current version beats newer records of an older version", () => {
    expect(
      statusOf([
        record("2026-01-01T10:00:00Z", "passed"),
        record("2026-01-05T10:00:00Z", "failed", { version: OLDER }),
      ]),
    ).toEqual(["verified", "verified"]);
    expect(
      statusOf([
        record("2026-01-01T10:00:00Z", "failed"),
        record("2026-01-05T10:00:00Z", "passed", { version: OLDER }),
      ]),
    ).toEqual(["failed", "failed"]);
  });

  it("an element whose current version is unknown has no record of it: outdated with records", () => {
    expect(verificationStatusOf([record("2026-01-01T10:00:00Z", "passed")], undefined, CORE)).toBe(
      "outdated",
    );
  });

  it("two newest records of the current version with the same date, one failed, give failed (#525 Q2)", () => {
    // The same instant written in two time zones.
    expect(
      statusOf([
        record("2026-01-02T10:00:00Z", "passed", { file: "a.xml" }),
        record("2026-01-02T12:00:00+02:00", "failed", { file: "b.xml" }),
        record("2026-01-01T10:00:00Z", "passed"),
      ]),
    ).toEqual(["failed", "failed"]);
    expect(
      statusOf([
        record("2026-01-02T10:00:00Z", "passed", { file: "a.xml" }),
        record("2026-01-02T10:00:00Z", "passed", { file: "b.xml" }),
        record("2026-01-01T10:00:00Z", "failed"),
      ]),
    ).toEqual(["verified", "verified"]);
  });

  it("a date that cannot be read counts as the oldest", () => {
    expect(statusOf([record("not a date", "failed"), record("2026-01-01T10:00:00Z", "passed")])).toEqual([
      "verified",
      "verified",
    ]);
    expect(statusOf([record("not a date", "failed")])).toEqual(["failed", "failed"]);
  });

  it("a record for a variant counts only in that variant, one without variant only in the core (SR-047)", () => {
    const forV = record("2026-01-02T10:00:00Z", "failed", { variant: V });
    const core = record("2026-01-01T10:00:00Z", "passed");
    expect(statusOf([forV, core])).toEqual(["verified", "verified"]);
    expect(statusOf([forV, core], IN_V)).toEqual(["failed", "failed"]);
    expect(statusOf([forV])).toEqual(["open", "open"]);
    expect(statusOf([core], IN_V)).toEqual(["open", "open"]);
    expect([holdsIn(forV, IN_V), holdsIn(forV, CORE), holdsIn(core, CORE), holdsIn(core, IN_V)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("validation records do not count for the verification status (D-007)", () => {
    const validation = record("2026-01-02T10:00:00Z", "failed", { kind: "validation" });
    expect(statusOf([validation])).toEqual(["open", "open"]);
    expect(statusOf([validation, record("2026-01-01T10:00:00Z", "passed")])).toEqual([
      "verified",
      "verified",
    ]);
    // The same rule with the kind validation (SR-038 reuses it).
    expect(recordStatusOf([validation], "validation", CURRENT, CORE)).toBe("failed");
    expect(recordStatusOf([validation], "validation", OLDER, CORE)).toBe("outdated");
  });
});
