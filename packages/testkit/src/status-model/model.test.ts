// Example tests of the reference model: the worked examples of the rules in README.md. They name rules (V…, A…),
// never an [SR/AK] token, because they check the model, not the tool (#1394).
import { describe, expect, it } from "vitest";
import {
  type ModelCriterion,
  type ModelElement,
  type ModelRecord,
  instantOf,
  newestOf,
  olderRefKey,
  validationOf,
  verificationOf,
  worseResult,
} from "./model.js";

const T1 = "2026-11-01T10:00:00Z";
const T2 = "2026-11-02T10:00:00Z";

function verification(result: "passed" | "failed", date = T1, extra: Partial<ModelRecord> = {}): ModelRecord {
  return { kind: "verification", version: "current", date, result, ...extra };
}

function validation(result: ModelRecord["result"], date = T1, extra: Partial<ModelRecord> = {}): ModelRecord {
  return { kind: "validation", version: "current", date, result, ...extra };
}

function element(
  records: ModelRecord[],
  criteria: ModelCriterion[] = [],
  olderVersions = [] as ModelElement["olderVersions"],
) {
  return { criteria, olderVersions, records };
}

const abc: ModelCriterion[] = [{ key: "alpha" }, { key: "bravo" }, { key: "charlie" }];

describe("status model: verification status", () => {
  it("V3: is open without a record", () => {
    expect(verificationOf(element([], abc))).toEqual({
      status: "open",
      criteria: ["open", "open", "open"],
      verified: 0,
    });
    expect(verificationOf(element([])).status).toBe("open");
  });

  it("V4, V10: is verified when the newest current record of every criterion passed", () => {
    expect(verificationOf(element([verification("failed", T1), verification("passed", T2)], abc))).toEqual({
      status: "verified",
      criteria: ["verified", "verified", "verified"],
      verified: 3,
    });
  });

  it("V5: is failed when the newest current record of one criterion failed", () => {
    const records = [
      verification("passed"),
      verification("failed", T2, { criteria: [{ by: "key", key: "bravo" }] }),
    ];
    expect(verificationOf(element(records, abc)).status).toBe("failed");
  });

  it("V6, V15: is outdated with records of older versions only, also when a criterion has none", () => {
    const older = verification("passed", T1, { version: "v1", criteria: [{ by: "key", key: "alpha" }] });
    expect(verificationOf(element([older], abc, [{ id: "v1", criteria: abc }]))).toEqual({
      status: "outdated",
      criteria: ["outdated", "open", "open"],
      verified: 0,
    });
  });

  it("V15, V16: is open with 2 of 3 when the third criterion has no record", () => {
    const records = [
      verification("passed", T1, { criteria: [{ by: "key", key: "alpha" }] }),
      verification("passed", T1, { criteria: [{ by: "number", number: 2 }] }),
    ];
    expect(verificationOf(element(records, abc))).toEqual({
      status: "open",
      criteria: ["verified", "verified", "open"],
      verified: 2,
    });
  });

  it("V15: is outdated when no criterion failed, one has older records only and the others are verified", () => {
    const records = [
      verification("passed", T1, {
        criteria: [
          { by: "key", key: "alpha" },
          { by: "key", key: "bravo" },
        ],
      }),
      verification("passed", T1, { version: "v1", criteria: [{ by: "key", key: "charlie" }] }),
    ];
    expect(verificationOf(element(records, abc, [{ id: "v1", criteria: abc }]))).toEqual({
      status: "outdated",
      criteria: ["verified", "verified", "outdated"],
      verified: 2,
    });
  });

  it("V15: open comes before outdated once a current record exists", () => {
    const records = [
      verification("passed", T1, { criteria: [{ by: "key", key: "alpha" }] }),
      verification("passed", T1, { version: "v1", criteria: [{ by: "key", key: "bravo" }] }),
    ];
    expect(verificationOf(element(records, abc, [{ id: "v1", criteria: abc }])).status).toBe("open");
  });

  it("V15: failed comes before outdated without a current record of another criterion", () => {
    const records = [
      verification("failed", T1, { criteria: [{ by: "key", key: "alpha" }] }),
      verification("passed", T1, { version: "v1" }),
    ];
    expect(verificationOf(element(records, abc, [{ id: "v1" }])).criteria).toEqual([
      "failed",
      "outdated",
      "outdated",
    ]);
    expect(verificationOf(element(records, abc, [{ id: "v1" }])).status).toBe("failed");
  });

  it("V7, V9: a tie at the same instant in two offsets fails when one of them failed", () => {
    const records = [verification("passed", "2026-11-01T12:00:00+02:00"), verification("failed", T1)];
    expect(verificationOf(element(records, [{ key: "alpha" }])).status).toBe("failed");
  });

  it("V8: a date that cannot be read is older than any other", () => {
    const records = [verification("failed", "not a date"), verification("passed", T1)];
    expect(verificationOf(element(records, [{ key: "alpha" }])).status).toBe("verified");
    expect(instantOf("not a date")).toBe(Number.NEGATIVE_INFINITY);
    expect(newestOf([verification("passed", "x"), verification("failed", "y")])).toHaveLength(2);
  });

  it("V11, V12: a current record counts for named keys and numbers, and for none when all are unknown", () => {
    const unknown = verification("failed", T2, {
      criteria: [
        { by: "key", key: "zulu" },
        { by: "number", number: 4 },
      ],
    });
    expect(verificationOf(element([verification("passed", T1), unknown], abc)).status).toBe("verified");
    const keyless = verification("failed", T2, { criteria: [{ by: "key", key: "alpha" }] });
    expect(verificationOf(element([verification("passed", T1), keyless], [{}])).status).toBe("verified");
  });

  it("V12, V15: a current record naming only unknown criteria makes the requirement open, not outdated", () => {
    const records = [
      verification("passed", T2, { criteria: [{ by: "number", number: 9 }] }),
      verification("passed", T1, { version: "v1", criteria: [{ by: "key", key: "alpha" }] }),
    ];
    const versions = [{ id: "v1", criteria: abc }];
    expect(verificationOf(element(records, abc, versions))).toEqual({
      status: "open",
      criteria: ["outdated", "open", "open"],
      verified: 0,
    });
    expect(verificationOf(element(records.slice(1), abc, versions)).status).toBe("outdated");
  });

  it("V13: an older record counts by key, or by number through the key of that version", () => {
    const moved: ModelCriterion[] = [{ key: "charlie" }, {}, { key: "alpha" }];
    const versions = [{ id: "v1", criteria: moved }];
    const byNumber = verification("passed", T1, { version: "v1", criteria: [{ by: "number", number: 1 }] });
    expect(verificationOf(element([byNumber], abc, versions)).criteria).toEqual(["open", "open", "outdated"]);
    const byKey = verification("passed", T1, { version: "v1", criteria: [{ by: "key", key: "bravo" }] });
    expect(verificationOf(element([byKey], abc, versions)).criteria).toEqual(["open", "outdated", "open"]);
  });

  it("V13: an older record counts for no criterion through a missing number, a keyless criterion or an unknown version", () => {
    const versions = [{ id: "v1", criteria: [{}, { key: "zulu" }] }, { id: "v2" }];
    const records = [
      verification("passed", T1, { version: "v1", criteria: [{ by: "number", number: 1 }] }),
      verification("passed", T1, { version: "v1", criteria: [{ by: "number", number: 2 }] }),
      verification("passed", T1, { version: "v1", criteria: [{ by: "number", number: 3 }] }),
      verification("passed", T1, { version: "v2", criteria: [{ by: "number", number: 1 }] }),
    ];
    expect(verificationOf(element(records, abc, versions))).toEqual({
      status: "outdated",
      criteria: ["open", "open", "open"],
      verified: 0,
    });
    expect(olderRefKey({ by: "number", number: 1 }, undefined)).toBeUndefined();
    const keyless = verification("passed", T1, { version: "v1", criteria: [{ by: "key", key: "alpha" }] });
    expect(verificationOf(element([keyless], [{}], versions)).criteria).toEqual(["open"]);
  });

  it("V14: without criteria the newest current records decide, also ones that name criteria", () => {
    const named = verification("failed", T2, { criteria: [{ by: "key", key: "alpha" }] });
    expect(verificationOf(element([verification("passed", T1), named]))).toEqual({
      status: "failed",
      criteria: [],
      verified: 0,
    });
    expect(verificationOf(element([verification("passed", T1)])).status).toBe("verified");
    expect(verificationOf(element([verification("passed", T1, { version: "v1" })])).status).toBe("outdated");
  });

  it("V1: validation records never change the verification status", () => {
    expect(verificationOf(element([validation("failed")], abc)).status).toBe("open");
  });
});

describe("status model: validation status", () => {
  it("A1, A2: is open without a validation record; verification records and criteria do not count", () => {
    expect(validationOf(element([verification("failed")]))).toEqual({ status: "open" });
    expect(
      validationOf(element([validation("passed", T1, { criteria: [{ by: "number", number: 7 }] })], abc)),
    ).toEqual({
      status: "validated",
    });
  });

  it("A3: the newest current record decides", () => {
    expect(validationOf(element([validation("failed", T1), validation("passed", T2)]))).toEqual({
      status: "validated",
    });
    expect(validationOf(element([validation("passed", T1), validation("failed", T2)]))).toEqual({
      status: "failed",
    });
  });

  it("A4: on a tie the worst result wins, failed before inconclusive before passed", () => {
    const inconclusive = validation("inconclusive", T1, { reason: "no user yet" });
    expect(validationOf(element([validation("passed"), inconclusive]))).toEqual({
      status: "inconclusive",
      reason: "no user yet",
    });
    expect(validationOf(element([inconclusive, validation("failed")]))).toEqual({ status: "failed" });
    expect(worseResult("failed", "passed")).toBe("failed");
  });

  it("A5: is outdated with records of older versions only", () => {
    expect(validationOf(element([validation("inconclusive", T2, { version: "v1", reason: "r" })]))).toEqual({
      status: "outdated",
    });
  });

  it("A6: an inconclusive tie carries the reason of the first inconclusive record", () => {
    const records = [
      validation("inconclusive", T1, { reason: "first" }),
      validation("inconclusive", "2026-11-01T11:00:00+01:00", { reason: "second" }),
    ];
    expect(validationOf(element(records))).toEqual({ status: "inconclusive", reason: "first" });
    expect(validationOf(element([validation("inconclusive")]))).toEqual({ status: "inconclusive" });
  });
});
