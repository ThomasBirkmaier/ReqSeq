// The verification status (SR-031) and the validation status (SR-038) from records (ADR-0012 "Status
// rules"), as pure functions of the records of one element, its current version and a view. The
// commands that show it (evidence.status, element.get) and the filter are tested in
// commands/evidence/status.test.ts.
import { describe, expect, it } from "vitest";
import { forms } from "../model/version-forms.test-helper.js";
import type { View } from "../variants/index.js";
import { evidenceIndex } from "./by-element.js";
import type { EvidenceRecord } from "./record.js";
import type { Validation } from "./status.js";
import { holdsIn } from "./holds.js";
import { recordStatusOf, validationOf, verificationStatusOf } from "./status.js";

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
const statusOf = (records: readonly EvidenceRecord[], view: View = CORE, independent = false): string[] => {
  const ordered = evidenceIndex(records).byElement.get(A) ?? [];
  return [
    verificationStatusOf(ordered, forms(CURRENT), view, independent),
    verificationStatusOf([...ordered].reverse(), forms(CURRENT), view, independent),
  ];
};

describe("verificationStatusOf (SR-031)", () => {
  it("[SR-031/AK1] a requirement without records is open", () => {
    expect(verificationStatusOf([], forms(CURRENT), CORE, false)).toBe("open");
    expect(verificationStatusOf([], undefined, IN_V, false)).toBe("open");
  });

  it("[SR-031/AK2] a record of either normal form of the current version counts (ADR-0005)", () => {
    const both = { n1: CURRENT, n2: "n2:1111111111111111" };
    const ofN2 = [record("2026-01-01T10:00:00Z", "passed", { version: both.n2 })];
    expect(verificationStatusOf(ofN2, both, CORE, false)).toBe("verified");
    // Mixed forms: the newest record of the current version decides, whatever its form.
    const mixed = [...ofN2, record("2026-01-02T10:00:00Z", "failed")];
    expect(verificationStatusOf(mixed, both, CORE, false)).toBe("failed");
    expect(verificationStatusOf(ofN2, { n1: CURRENT, n2: "n2:2222222222222222" }, CORE, false)).toBe(
      "outdated",
    );
    expect(
      validationOf(
        [record("2026-01-01T10:00:00Z", "passed", { kind: "validation", version: both.n2 })],
        both,
      ),
    ).toEqual({
      status: "validated",
    });
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
    expect(verificationStatusOf([record("2026-01-01T10:00:00Z", "passed")], undefined, CORE, false)).toBe(
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
    expect([
      holdsIn(forV, IN_V, false),
      holdsIn(forV, CORE, false),
      holdsIn(core, CORE, false),
      holdsIn(core, IN_V, false),
    ]).toEqual([true, false, true, false]);
  });

  it("holdsIn: a record without variant holds in every variant only for an element of a marked repository (SR-173)", () => {
    const forV = record("2026-01-02T10:00:00Z", "failed", { variant: V });
    const forW = record("2026-01-02T10:00:00Z", "failed", { variant: `${P}c0000000002` });
    const core = record("2026-01-01T10:00:00Z", "passed");
    // record × view × mark: the mark only adds the variant-less record in a variant.
    const table = [forV, forW, core].flatMap((r) =>
      [CORE, IN_V].flatMap((view) => [false, true].map((independent) => holdsIn(r, view, independent))),
    );
    expect(table).toEqual([
      // forV: core, core marked, V, V marked
      false,
      false,
      true,
      true,
      // forW
      false,
      false,
      false,
      false,
      // core record
      true,
      true,
      false,
      true,
    ]);
  });

  it("pools the records without variant and those of the variant of a marked element: the newest decides, failed wins a tie (SR-173)", () => {
    const core = record("2026-01-01T10:00:00Z", "passed");
    const newerFailedV = record("2026-01-02T10:00:00Z", "failed", { variant: V });
    expect(statusOf([core, newerFailedV], IN_V, true)).toEqual(["failed", "failed"]);
    const olderFailedV = record("2025-12-31T10:00:00Z", "failed", { variant: V });
    expect(statusOf([core, olderFailedV], IN_V, true)).toEqual(["verified", "verified"]);
    const tieFailedV = record("2026-01-01T10:00:00Z", "failed", { variant: V });
    expect(statusOf([core, tieFailedV], IN_V, true)).toEqual(["failed", "failed"]);
    expect(statusOf([core], IN_V, true)).toEqual(["verified", "verified"]);
    // The core still counts only the records without variant.
    expect(statusOf([core, newerFailedV], CORE, true)).toEqual(["verified", "verified"]);
  });

  it("validation records do not count for the verification status (D-007)", () => {
    const validation = record("2026-01-02T10:00:00Z", "failed", { kind: "validation" });
    expect(statusOf([validation])).toEqual(["open", "open"]);
    expect(statusOf([validation, record("2026-01-01T10:00:00Z", "passed")])).toEqual([
      "verified",
      "verified",
    ]);
    // The same rule with the kind validation (SR-038 reuses it).
    expect(recordStatusOf([validation], "validation", forms(CURRENT), CORE, false)).toBe("failed");
    expect(recordStatusOf([validation], "validation", forms(OLDER), CORE, false)).toBe("outdated");
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

/** The validation of `records` of A against `current`, in the order of the index and reversed. */
const validationsOf = (
  records: readonly EvidenceRecord[],
  current: string | undefined = CURRENT,
): Validation[] => {
  const ordered = evidenceIndex(records).byElement.get(A) ?? [];
  return [validationOf(ordered, forms(current)), validationOf([...ordered].reverse(), forms(current))];
};

/** The validation status of `records` of A against `current`, in the order of the index and reversed. */
const statusesOf = (records: readonly EvidenceRecord[], current: string | undefined = CURRENT): string[] =>
  validationsOf(records, current).map((v) => v.status);

describe("validationOf (SR-038)", () => {
  it("[SR-038/AK3] an element without validation record is open", () => {
    expect(statusesOf([])).toEqual(["open", "open"]);
  });

  it.each([
    ["passed", "failed", "failed"],
    ["failed", "passed", "validated"],
    ["passed", "passed", "validated"],
  ] as const)(
    "[SR-038/AK3] the newest validation record of the current version decides: older %s, newer %s gives %s",
    (older, newer, status) => {
      expect(
        statusesOf([validation("2026-01-01T10:00:00Z", older), validation("2026-02-01T10:00:00Z", newer)]),
      ).toEqual([status, status]);
    },
  );

  it("[SR-038/AK2] a validation of an older version gives outdated", () => {
    expect(statusesOf([validation("2026-01-01T10:00:00Z", "passed", { version: OLDER })])).toEqual([
      "outdated",
      "outdated",
    ]);
  });

  it("[SR-038/AK3] only records of older versions give outdated; a record of the current version beats newer records of an older version", () => {
    expect(
      statusesOf([
        validation("2026-01-01T10:00:00Z", "failed", { version: OLDER }),
        validation("2026-02-01T10:00:00Z", "passed", { version: "n1:2222222222222222" }),
      ]),
    ).toEqual(["outdated", "outdated"]);
    expect(
      statusesOf([
        validation("2026-01-01T10:00:00Z", "passed"),
        validation("2026-02-01T10:00:00Z", "failed", { version: OLDER }),
      ]),
    ).toEqual(["validated", "validated"]);
  });

  it("[SR-038/AK1] verification records do not count for the validation status", () => {
    expect(statusesOf([record("2026-01-01T10:00:00Z", "passed")])).toEqual(["open", "open"]);
    expect(
      statusesOf([record("2026-02-01T10:00:00Z", "failed"), validation("2026-01-01T10:00:00Z", "passed")]),
    ).toEqual(["validated", "validated"]);
  });

  it("two newest validation records of the current version with the same date, one failed, give failed (#525 Q2)", () => {
    expect(
      statusesOf([
        validation("2026-01-02T10:00:00Z", "passed", { file: "a.md" }),
        validation("2026-01-02T10:00:00Z", "failed", { file: "b.md" }),
      ]),
    ).toEqual(["failed", "failed"]);
  });

  it("a validation record with a variant does not count: the validation status is the core's (#534 Q2)", () => {
    expect(statusesOf([validation("2026-01-01T10:00:00Z", "passed", { variant: V })])).toEqual([
      "open",
      "open",
    ]);
  });

  it("an element whose current version is unknown: outdated with records, open without (#276)", () => {
    expect(validationOf([validation("2026-01-01T10:00:00Z", "passed")], undefined)).toEqual({
      status: "outdated",
    });
    expect(validationOf([], undefined)).toEqual({ status: "open" });
  });
});

describe("inconclusive validation (SR-172)", () => {
  const WHY = "The field test needs frost";

  it("[SR-038/AK3] [SR-172/AK2] the newest validation record of the current version is inconclusive: inconclusive with its reason", () => {
    expect(
      validationsOf([
        validation("2026-01-01T10:00:00Z", "passed"),
        validation("2026-02-01T10:00:00Z", "inconclusive", { reason: WHY }),
        validation("2026-03-01T10:00:00Z", "failed", { version: OLDER }),
      ]),
    ).toEqual([
      { status: "inconclusive", reason: WHY },
      { status: "inconclusive", reason: WHY },
    ]);
    expect(
      statusesOf([
        validation("2026-01-01T10:00:00Z", "inconclusive", { reason: WHY }),
        validation("2026-02-01T10:00:00Z", "passed"),
      ]),
    ).toEqual(["validated", "validated"]);
  });

  it("[SR-172/AK2] an inconclusive record of an older version gives outdated, without reason", () => {
    expect(
      validationsOf([validation("2026-01-01T10:00:00Z", "inconclusive", { reason: WHY, version: OLDER })]),
    ).toEqual([{ status: "outdated" }, { status: "outdated" }]);
  });

  it("on a tie at the newest date failed comes before inconclusive before passed; the first inconclusive gives the reason (#807 Q3)", () => {
    const tie = (result: EvidenceRecord["result"], file: string, reason?: string): EvidenceRecord =>
      validation("2026-01-02T10:00:00Z", result, { file, ...(reason === undefined ? {} : { reason }) });
    const older = validation("2026-01-01T10:00:00Z", "inconclusive", { reason: "older", file: "0.md" });
    expect(statusesOf([older, tie("passed", "a.md"), tie("inconclusive", "b.md", WHY)])).toEqual([
      "inconclusive",
      "inconclusive",
    ]);
    // The reason is that of the newest records in either order, never of an older one.
    expect(validationsOf([older, tie("passed", "a.md"), tie("inconclusive", "b.md", WHY)])).toEqual([
      { status: "inconclusive", reason: WHY },
      { status: "inconclusive", reason: WHY },
    ]);
    expect(validationsOf([tie("inconclusive", "a.md"), older])).toEqual([
      { status: "inconclusive" },
      { status: "inconclusive" },
    ]);
    expect(statusesOf([tie("inconclusive", "a.md", WHY), tie("failed", "b.md")])).toEqual([
      "failed",
      "failed",
    ]);
    const ordered = evidenceIndex([
      older,
      tie("inconclusive", "a.md", "first"),
      tie("inconclusive", "b.md", "second"),
    ]).byElement.get(A);
    expect(validationOf(ordered ?? [], forms(CURRENT))).toEqual({ status: "inconclusive", reason: "first" });
  });

  it("an inconclusive record without reason given through the state is inconclusive without reason", () => {
    expect(validationOf([validation("2026-01-01T10:00:00Z", "inconclusive")], forms(CURRENT))).toEqual({
      status: "inconclusive",
    });
  });

  it("an inconclusive verification record given through the state counts as a record of no current version (#807 Q2)", () => {
    expect(statusOf([record("2026-01-01T10:00:00Z", "inconclusive")])).toEqual(["outdated", "outdated"]);
    expect(
      statusOf([record("2026-01-01T10:00:00Z", "passed"), record("2026-01-02T10:00:00Z", "inconclusive")]),
    ).toEqual(["verified", "verified"]);
  });
});
