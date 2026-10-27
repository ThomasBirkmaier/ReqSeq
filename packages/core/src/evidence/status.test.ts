// The verification status (SR-031) and the validation status (SR-038) from records (ADR-0012 "Status
// rules"), as pure functions of the records of one element, its current version and a view. The
// commands that show it (evidence.status, element.get) and the filter are tested in
// commands/evidence/status.test.ts.
import { describe, expect, it } from "vitest";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { EvidenceRecord } from "./record.js";
import { holdsIn, recordStatusOf, validationStatusOf, verificationStatusOf } from "./status.js";

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

/**
 * The status of `records` of A in the core against CURRENT, the records in the order of the index and
 * reversed.
 */
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

/** A validation record of A. */
const validation = (
  date: string,
  result: EvidenceRecord["result"],
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  element: A,
  version: CURRENT,
  kind: "validation",
  result,
  date,
  ...more,
});

/** The validation status of `records` of A against `current`, in the order of the index and reversed. */
const validationOf = (
  records: readonly EvidenceRecord[],
  current: string | undefined = CURRENT,
): string[] => {
  const ordered = evidenceIndex(records).byElement.get(A) ?? [];
  return [validationStatusOf(ordered, current), validationStatusOf([...ordered].reverse(), current)];
};

describe("validationStatusOf (SR-038)", () => {
  it("[SR-038/AK3] an element without validation record is open", () => {
    expect(validationOf([])).toEqual(["open", "open"]);
  });

  it.each([
    ["passed", "failed", "failed"],
    ["failed", "passed", "validated"],
    ["passed", "passed", "validated"],
  ] as const)(
    "[SR-038/AK3] the newest validation record of the current version decides: older %s, newer %s gives %s",
    (older, newer, status) => {
      expect(
        validationOf([validation("2026-01-01T10:00:00Z", older), validation("2026-02-01T10:00:00Z", newer)]),
      ).toEqual([status, status]);
    },
  );

  it("[SR-038/AK2] a validation of an older version gives outdated", () => {
    expect(validationOf([validation("2026-01-01T10:00:00Z", "passed", { version: OLDER })])).toEqual([
      "outdated",
      "outdated",
    ]);
  });

  it("[SR-038/AK3] only records of older versions give outdated; a record of the current version beats newer records of an older version", () => {
    expect(
      validationOf([
        validation("2026-01-01T10:00:00Z", "failed", { version: OLDER }),
        validation("2026-02-01T10:00:00Z", "passed", { version: "n1:2222222222222222" }),
      ]),
    ).toEqual(["outdated", "outdated"]);
    expect(
      validationOf([
        validation("2026-01-01T10:00:00Z", "passed"),
        validation("2026-02-01T10:00:00Z", "failed", { version: OLDER }),
      ]),
    ).toEqual(["validated", "validated"]);
  });

  it("[SR-038/AK1] verification records do not count for the validation status", () => {
    expect(validationOf([record("2026-01-01T10:00:00Z", "passed")])).toEqual(["open", "open"]);
    expect(
      validationOf([record("2026-02-01T10:00:00Z", "failed"), validation("2026-01-01T10:00:00Z", "passed")]),
    ).toEqual(["validated", "validated"]);
  });

  it("two newest validation records of the current version with the same date, one failed, give failed (#525 Q2)", () => {
    expect(
      validationOf([
        validation("2026-01-02T10:00:00Z", "passed", { file: "a.md" }),
        validation("2026-01-02T10:00:00Z", "failed", { file: "b.md" }),
      ]),
    ).toEqual(["failed", "failed"]);
  });

  it("a validation record with a variant does not count: the validation status is the core's (#534 Q2)", () => {
    expect(validationOf([validation("2026-01-01T10:00:00Z", "passed", { variant: V })])).toEqual([
      "open",
      "open",
    ]);
  });

  it("an element whose current version is unknown: outdated with records, open without (#276)", () => {
    expect(validationStatusOf([validation("2026-01-01T10:00:00Z", "passed")], undefined)).toBe("outdated");
    expect(validationStatusOf([], undefined)).toBe("open");
  });
});
