// The requirements without a passed test execution (SR-120, spec question #532) as a pure function of a
// status source made by hand: which records are a passed test execution, and which elements are listed.
// The command (`evidence.withoutPassedTest`) on record files is tested in
// commands/evidence/withoutPassedTest.test.ts.
import { describe, expect, it } from "vitest";
import type { ElementRecord } from "../model/index.js";
import type { View } from "../variants/index.js";
import { appliesIn } from "../variants/index.js";
import type { EvidenceRecord } from "./record.js";
import type { StatusSource } from "./status.js";
import { isPassedTest, withoutPassedTest } from "./without-passed-test.js";

const P = "12012012-0120-4120-8120-0000000";
const V = `${P}0c001`;
const CURRENT = "n1:1111111111111111";
const OLDER = "n1:0000000000000000";
const CORE: View = { kind: "core" };
const IN_V: View = { kind: "variant", variant: { id: V, repository: "system" } };

let next = 0;

/** An element of the repository `system`: a requirement (type `req`) with status draft unless given. */
const element = (data: Readonly<Record<string, unknown>> = {}): ElementRecord => {
  next += 1;
  const id = `${P}${next.toString(16).padStart(5, "0")}`;
  const type = typeof data["type"] === "string" ? data["type"] : "req";
  return {
    id,
    type,
    repository: "system",
    file: `${id}.md`,
    data: { id, type, status: "draft", ...data },
    eol: "\n",
    closingEol: "\n",
    bom: false,
    snapshot: { path: `${id}.md`, size: 0, mtimeMs: 0, sha256: "0".repeat(64) },
  };
};

/** A passed test of the current version on `element` in the core, with `more` changed. */
const record = (of: ElementRecord, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element: of.id,
  version: CURRENT,
  kind: "verification",
  method: "test",
  item: "build-1",
  result: "passed",
  date: "2026-10-28T10:00:00Z",
  ...more,
});

/** A status source over `records` (by element), with a validity property `validity`. */
const sourceOf = (records: readonly EvidenceRecord[]): StatusSource => ({
  requirements: new Set(["req", "sub-req"]),
  needs: new Set(["need"]),
  invalid: new Set(["obsolete"]),
  validity: { key: "validity", many: true, label: "property Validity (validity)" },
  recordsOf: (id) => records.filter((r) => r.element === id),
  emergent: () => false,
});

/** The views by validity alone, as the view rule without replacements and exclusions. */
const byValidity =
  (view: View) =>
  (e: ElementRecord): boolean =>
    appliesIn({ key: "validity", many: true }, e, view);

/** Whether `of` is listed with `records` in `view`. */
const listed = (of: ElementRecord, records: readonly EvidenceRecord[], view: View = CORE): boolean =>
  withoutPassedTest(sourceOf(records), [of], view, byValidity(view)).includes(of);

describe("withoutPassedTest (SR-120)", () => {
  it("[SR-120/AK2] a requirement with at least one passed test execution is not in the list", () => {
    const cases: readonly ((of: ElementRecord) => EvidenceRecord[])[] = [
      (of) => [record(of)],
      (of) => [record(of, { result: "failed", date: "2026-10-27T10:00:00Z" }), record(of)],
      // A regression: a newer run of the current version failed after the passed one.
      (of) => [record(of, { date: "2026-10-27T10:00:00Z" }), record(of, { result: "failed" })],
      (of) => [record(of, { version: OLDER })],
      (of) => [record(of), record(of, { result: "failed" })],
    ];
    for (const recordsOf of cases) {
      const of = element();
      expect(listed(of, recordsOf(of))).toBe(false);
    }
  });

  it("[SR-120/AK2] a requirement without test execution or only with failed ones is in the list", () => {
    const cases: readonly ((of: ElementRecord) => EvidenceRecord[])[] = [
      () => [],
      (of) => [record(of, { result: "failed" })],
      (of) => [record(of, { result: "failed", version: OLDER }), record(of, { result: "failed" })],
    ];
    for (const recordsOf of cases) {
      const of = element();
      expect(listed(of, recordsOf(of))).toBe(true);
    }
  });

  it("an inspection, analysis or demonstration that passed is no test execution (#532)", () => {
    for (const method of ["inspection", "analysis", "demonstration"] as const) {
      const of = element();
      expect(listed(of, [record(of, { method })])).toBe(true);
    }
  });

  it("a validation record with method test that passed does not count (#532, D-007)", () => {
    const of = element();
    expect(listed(of, [record(of, { kind: "validation" })])).toBe(true);
  });

  it("counts a record only in its own view: a variant's in the variant, a core record in the core (SR-047)", () => {
    const inV = element();
    expect([
      listed(inV, [record(inV, { variant: V })]),
      listed(inV, [record(inV, { variant: V })], IN_V),
    ]).toEqual([true, false]);
    const inCore = element();
    expect([listed(inCore, [record(inCore)]), listed(inCore, [record(inCore)], IN_V)]).toEqual([false, true]);
  });

  it("lists only requirements with a valid status that apply in the view, in the order given (#532)", () => {
    const need = element({ type: "need" });
    const sub = element({ type: "sub-req" });
    const obsolete = element({ status: "obsolete" });
    const onlyV = element({ validity: [{ id: V }] });
    const plain = element();
    const elements = [plain, need, obsolete, onlyV, sub];
    expect(withoutPassedTest(sourceOf([]), elements, CORE, byValidity(CORE))).toEqual([plain, sub]);
    expect(withoutPassedTest(sourceOf([]), elements, IN_V, byValidity(IN_V))).toEqual([plain, onlyV, sub]);
    // The view decides, not the validity: one the view holds with a stray validity is listed (SR-043 AK10).
    expect(withoutPassedTest(sourceOf([]), [onlyV], CORE, () => true)).toEqual([onlyV]);
  });

  it("isPassedTest asks kind, method, result and view", () => {
    const of = element();
    expect(isPassedTest(record(of), CORE)).toBe(true);
    expect(isPassedTest(record(of, { kind: "validation" }), CORE)).toBe(false);
    expect(isPassedTest(record(of, { method: "inspection" }), CORE)).toBe(false);
    expect(isPassedTest(record(of, { result: "failed" }), CORE)).toBe(false);
    expect(isPassedTest(record(of), IN_V)).toBe(false);
  });
});
