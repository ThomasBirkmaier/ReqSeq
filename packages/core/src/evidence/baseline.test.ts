// `baselineStatusOf` (SR-031 for SR-094): the status of a baseline row with its criteria known or not
// (spec question #985). baseline.get itself is tested in commands/baseline/get-evidence.test.ts.
import { describe, expect, it } from "vitest";
import { forms } from "../model/version-forms.test-helper.js";
import type { View } from "../variants/index.js";
import { baselineStatusOf } from "./baseline.js";
import type { EvidenceRecord } from "./record.js";

const VERSION = "n1:1111111111111111";
const CORE: View = { kind: "core" };

const record = (
  date: string,
  result: EvidenceRecord["result"],
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  element: "5e031a7d-2b4f-4c61-9d08-0b0000000001",
  version: VERSION,
  kind: "verification",
  method: "test",
  item: "build-1",
  result,
  date,
  ...more,
});

const statusOf = (records: readonly EvidenceRecord[], count: number | undefined) =>
  baselineStatusOf(records, forms(VERSION), CORE, false, count);

describe("baselineStatusOf (SR-031, SR-094)", () => {
  it("counts the criteria of the baseline version when they are known", () => {
    expect(statusOf([record("2026-11-01T10:00:00Z", "passed", { criteria: [1] })], 2)).toEqual({
      status: "open",
      criteria: { verified: 1, total: 2, notVerified: [2] },
    });
  });

  it("without the criteria of the version, decides without a count (#985)", () => {
    const named = record("2026-11-01T10:00:00Z", "passed", { criteria: [1] });
    expect(statusOf([], undefined)).toEqual({ status: "open" });
    expect(
      statusOf([record("2026-11-01T10:00:00Z", "passed", { version: "n1:0000000000000000" })], undefined),
    ).toEqual({
      status: "outdated",
    });
    expect(statusOf([named, record("2026-11-02T10:00:00Z", "failed", { criteria: [2] })], undefined)).toEqual(
      {
        status: "failed",
      },
    );
    expect(statusOf([named], undefined)).toEqual({ status: "open" });
    expect(statusOf([named, record("2026-10-01T10:00:00Z", "passed")], undefined)).toEqual({
      status: "verified",
    });
  });
});
