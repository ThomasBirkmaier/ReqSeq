// displayOf (SR-032 AK3 to AK5, #1320): the Evidence section at a glance as `evidence.list` gives it.
// The AK tags of AK4 and AK5 are on the app's tests (#1321), which show it "in der App".
import { describe, expect, it } from "vitest";
import type { VersionForms } from "../model/index.js";
import type { View } from "../variants/index.js";
import { bearingRecords } from "./bearing.js";
import { displayOf } from "./display.js";
import type { ElementCriteria } from "./criteria.js";
import { elementCriteria } from "./criteria.js";
import type { EvidenceRecord } from "./record.js";
import { ownVerificationOf } from "./status.js";

const CURRENT: VersionForms = { n1: "n1:cccccccccccccccc", n2: "n2:cccccccccccccccc" };
const OLD = "n1:0000000000000000";
const CORE: View = { kind: "core" };
const variant = (id: string): View => ({ kind: "variant", variant: { id, repository: "system" } });
const MAC = variant("mac");
const WIN = variant("win");

const record = (more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "verification",
  element: "e",
  version: CURRENT.n1,
  method: "test",
  item: "main@abc",
  result: "passed",
  date: "2026-11-09T08:48:23Z",
  ...more,
});

/** A record without item (a validation record may leave it out, D-007). */
const withoutItem = (more: Partial<EvidenceRecord>): EvidenceRecord => {
  const { item: _item, ...rest } = record(more);
  return rest;
};

const display = (
  records: readonly EvidenceRecord[],
  count: ElementCriteria | number,
  views: readonly View[] = [CORE],
  independent = false,
  validates = true,
) =>
  displayOf(records, {
    bearing: bearingRecords(records, CURRENT, count, independent),
    current: CURRENT,
    criteria: count,
    views,
    independent,
    validates,
  });

describe("displayOf", () => {
  it("[SR-032/AK-hbdt] keeps the whole newest run open and folds older records by run, newest first", () => {
    const records = [
      record({ testCase: "a", criteria: [1] }),
      record({ testCase: "b", criteria: [1] }),
      record({ testCase: "a", criteria: [1], date: "2026-11-08T08:00:00Z" }),
      record({ testCase: "b", criteria: [1], date: "2026-11-08T08:00:00.000Z" }),
      record({ testCase: "a", criteria: [1], date: "2026-11-08T08:00:00Z", version: OLD }),
      record({ testCase: "a", criteria: [1], date: "2026-11-01T08:00:00Z" }),
    ];
    const shown = display(records, 1);
    expect(shown.rows[0]?.cases.map((c) => c.records)).toEqual([[0], [1]]);
    expect(shown.older).toEqual([
      { date: "2026-11-08T08:00:00Z", version: OLD, records: [4] },
      { date: "2026-11-08T08:00:00Z", version: CURRENT.n1, records: [2, 3] },
      { date: "2026-11-01T08:00:00Z", version: CURRENT.n1, records: [5] },
    ]);
  });

  it("gives one row per criterion with its status per view and the worst first; a criterion without record is open", () => {
    const records = [
      record({ testCase: "t1", className: "c", criteria: [1] }),
      record({ testCase: "t1", className: "c", criteria: [1], variant: "mac" }),
      record({ testCase: "t2", className: "c", criteria: [2], variant: "win", result: "failed" }),
      record({ testCase: "t3", className: "a", criteria: [2], variant: "win" }),
      record({ testCase: "t3", className: "a", criteria: [2] }),
    ];
    const shown = display(records, 3, [CORE, MAC, WIN]);
    expect(shown.rows).toEqual([
      {
        kind: "verification",
        criterion: 1,
        status: "open",
        views: [
          { view: "core", status: "verified" },
          { view: "mac", status: "verified" },
          { view: "win", status: "open" },
        ],
        cases: [
          { testCase: "t1", className: "c", result: "passed", views: ["core", "mac"], records: [0, 1] },
        ],
      },
      {
        kind: "verification",
        criterion: 2,
        status: "failed",
        views: [
          { view: "core", status: "verified" },
          { view: "mac", status: "open" },
          { view: "win", status: "failed" },
        ],
        cases: [
          { testCase: "t2", className: "c", result: "failed", views: ["win"], records: [2] },
          { testCase: "t3", className: "a", result: "passed", views: ["core", "win"], records: [3, 4] },
        ],
      },
      {
        kind: "verification",
        criterion: 3,
        status: "open",
        views: [
          { view: "core", status: "open" },
          { view: "mac", status: "open" },
          { view: "win", status: "open" },
        ],
        cases: [],
      },
    ]);
  });

  it("agrees with the status of each view (SR-031): verified only when every row is", () => {
    const cases: EvidenceRecord[][] = [
      [record({ criteria: [1] }), record({ criteria: [2], result: "failed" })],
      [record({ criteria: [1] }), record({ criteria: [2], version: OLD })],
      [record({ criteria: [1, 2] }), record({ criteria: [9] })],
      [record(), record({ criteria: [2], result: "failed", date: "2026-11-01T00:00:00Z" })],
      [record({ version: OLD, result: "failed" })],
    ];
    for (const records of cases) {
      for (const view of [CORE, MAC]) {
        const own = ownVerificationOf(records, CURRENT, view, false, 2);
        const rows = display(records, 2, [view]).rows;
        const statuses = rows.map((row) => row.views?.[0]?.status);
        expect(statuses.every((s) => s === "verified")).toBe(own.status === "verified");
        expect(statuses.includes("failed")).toBe(own.status === "failed");
        expect((own.criteria?.notVerified ?? []).map((c) => c.criterion)).toEqual(
          statuses.flatMap((s, i) => (s === "verified" ? [] : [i + 1])),
        );
      }
    }
  });

  it("names a failed and an outdated view by the status rule, also mixed with current ones", () => {
    // An older record names its criterion by key (by number it would count for none without Git, SR-031 AK11).
    const records = [
      record({ criteria: ["kone"], variant: "mac", version: OLD }),
      record({ criteria: [1], variant: "win" }),
      record({ criteria: ["kone"], version: OLD, result: "failed" }),
    ];
    const [row] = display(records, elementCriteria("e", [{ key: "kone", text: "One" }]), [
      CORE,
      MAC,
      WIN,
    ]).rows;
    expect(row?.status).toBe("outdated");
    expect([row?.criterion, row?.key, row?.text]).toEqual([1, "kone", "One"]);
    expect(row?.views).toEqual([
      { view: "core", status: "outdated" },
      { view: "mac", status: "outdated" },
      { view: "win", status: "verified" },
    ]);
  });

  it("pools records without variant in a variant-independent repository and leaves out views the element does not apply in", () => {
    const records = [record({ testCase: "t", result: "failed" }), record({ testCase: "u", variant: "gone" })];
    const shown = display(records, 0, [CORE, MAC], true);
    // The record for a variant the element does not apply in is no case; it is folded away.
    expect(shown.older).toEqual([{ date: "2026-11-09T08:48:23Z", version: CURRENT.n1, records: [1] }]);
    expect(shown.rows[0]).toEqual({
      kind: "verification",
      status: "failed",
      views: [
        { view: "core", status: "failed" },
        { view: "mac", status: "failed" },
      ],
      cases: [{ testCase: "t", result: "failed", views: ["core"], records: [0] }],
    });
  });

  it("puts a record without criterion under every criterion and a record without test case as its own case, last", () => {
    const records = [
      record({ item: "manual" }),
      record({ testCase: "z", criteria: [2] }),
      record({ item: "manual 2" }),
    ];
    const rows = display(records, 2).rows;
    expect(rows.map((row) => row.cases.map((c) => c.records))).toEqual([
      [[0], [2]],
      [[1], [0], [2]],
    ]);
    expect(rows[0]?.cases[0]).toEqual({ result: "passed", views: ["core"], records: [0] });
  });

  it("gives one row without criterion for a requirement without criteria, and a validation row after it", () => {
    const records = [
      record({ testCase: "t", className: "k" }),
      withoutItem({ kind: "validation", result: "inconclusive", testCase: "v" }),
      withoutItem({ kind: "validation", testCase: "v" }),
    ];
    const shown = display(records, 0);
    expect(shown.rows).toEqual([
      {
        kind: "verification",
        status: "verified",
        views: [{ view: "core", status: "verified" }],
        cases: [{ testCase: "t", className: "k", result: "passed", views: ["core"], records: [0] }],
      },
      {
        kind: "validation",
        status: "inconclusive",
        cases: [{ testCase: "v", result: "inconclusive", views: ["core"], records: [1, 2] }],
      },
    ]);
    // A validation record has no item: the item is not shared.
    expect(shown.shared).toEqual({ date: "2026-11-09T08:48:23Z", version: CURRENT.n1 });
  });

  it("shares date, item, version and baselines only when every open record has them equal", () => {
    const run = [
      record({
        baselines: ["Stufe 5", "Stufe 6"],
        date: "2026-11-09T08:48:23Z",
        item: "main@abc (macos-26)",
      }),
      record({
        baselines: ["Stufe 5", "Stufe 6"],
        date: "2026-11-09T08:48:23.000Z",
        item: "main@abc (macos-26)",
      }),
    ];
    expect(display(run, 0).shared).toEqual({
      date: "2026-11-09T08:48:23Z",
      item: "main@abc (macos-26)",
      version: CURRENT.n1,
      baselines: ["Stufe 5", "Stufe 6"],
    });
    // Three platforms of one run: one date, three items.
    const platforms = ["macos-26", "ubuntu-24.04", "windows-2025"].map((os) =>
      record({ item: `main@abc (${os})`, baselines: [os === "macos-26" ? "Stufe 6" : "Stufe 5"] }),
    );
    expect(display(platforms, 0).shared).toEqual({ date: "2026-11-09T08:48:23Z", version: CURRENT.n1 });
    expect(
      display([record({ baselines: ["a"] }), record({ baselines: ["a", "b"] })], 0).shared.baselines,
    ).toBe(undefined);
    expect(display([record({ baselines: ["a"] }), record()], 0).shared.baselines).toBe(undefined);
    // Each criterion's newest run on another day: no shared date.
    const days = [record({ criteria: [1] }), record({ criteria: [2], date: "2026-11-01T08:00:00Z" })];
    expect(display(days, 2).shared).toEqual({ item: "main@abc", version: CURRENT.n1 });
  });

  it("sorts cases by result, then class name, then name, and gives nothing for an element without records", () => {
    const records = [
      record({ testCase: "b", className: "y" }),
      record({ testCase: "a", className: "y" }),
      record({ testCase: "z", className: "x" }),
      record({ testCase: "q", className: "y" }),
      record({ testCase: "q", className: "y", result: "failed" }),
      record({ testCase: "only-name" }),
    ];
    expect(display(records, 0).rows[0]?.cases.map((c) => c.testCase)).toEqual([
      "q",
      "only-name",
      "z",
      "a",
      "b",
    ]);
    expect(display([], 2)).toEqual({ shared: {}, rows: [], older: [] });
    // Without views (no requirement) no verification row; its records are folded away.
    expect(display([record()], 1, [])).toEqual({
      shared: {},
      rows: [],
      older: [{ date: "2026-11-09T08:48:23Z", version: CURRENT.n1, records: [0] }],
    });
  });
});
