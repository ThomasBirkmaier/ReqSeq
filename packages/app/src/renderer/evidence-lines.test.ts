import type { DataExportEvidenceRecord, ElementName, EvidenceListOutput } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { elementBufferOf } from "./buffers.js";
import {
  INCOMPLETE_NOTE,
  evidenceLines,
  evidenceNotes,
  displayLines,
  evidenceRows,
} from "./evidence-lines.js";
import type { LinePart } from "./variant-lines.js";

const COAST: ElementName = { id: "uuid-v", repository: "system", shortId: "VAR-0000c1", title: "Coast" };

const record = (fields: Partial<DataExportEvidenceRecord>): DataExportEvidenceRecord => ({
  element: "uuid-e",
  version: "n1:1111111111111111",
  kind: "verification",
  result: "passed",
  date: "2026-10-21T09:00:00Z",
  ...fields,
});

const text = (parts: readonly LinePart[]): string => parts.map((part) => part.text).join("");

describe("the lines of an element's evidence records", () => {
  it("gives date, method, result, item, Beleg, version and baselines of each record, in core's order", () => {
    const lines = evidenceLines(
      {
        records: [
          record({
            method: "test",
            item: "build-512",
            repository: "system",
            file: "evidence/ci/results.xml",
            line: 4,
            evidenceSource: "system/evidence/ci/results.xml:4",
            baselines: ["Release 1.0", "Beta"],
          }),
          record({
            method: "inspection",
            item: "Display sample B2",
            evidence: "//fileserver/qa/inspection.docx",
            file: "evidence/record.md",
            evidenceSource: "//fileserver/qa/inspection.docx",
            date: "2026-10-20T14:00:00Z",
            baselines: [],
          }),
        ],
      },
      undefined,
    );
    expect(lines.map(text)).toEqual([
      "2026-10-21T09:00:00Z · test · passed · build-512 · system/evidence/ci/results.xml:4 · version n1:1111111111111111 · baselines Release 1.0, Beta",
      "2026-10-20T14:00:00Z · inspection · passed · Display sample B2 · //fileserver/qa/inspection.docx · version n1:1111111111111111",
    ]);
  });

  it("names the kind of a validation record, its reason on one line, and its variant as a link", () => {
    const [line] = evidenceLines(
      {
        records: [
          record({ kind: "validation", result: "inconclusive", reason: "no\n  pilot", variant: "uuid-v" }),
        ],
      },
      [COAST],
    );
    expect(text(line ?? [])).toBe(
      "2026-10-21T09:00:00Z · validation · inconclusive: no pilot · Coast · version n1:1111111111111111",
    );
    expect(line?.find((part) => "open" in part)).toEqual({
      text: "Coast",
      id: "uuid-v",
      open: elementBufferOf(COAST),
    });
  });

  it("gives the whole reason of each record whose line cuts it, else none (#862)", () => {
    const long = `First\n${"x".repeat(300)}`;
    const rows = evidenceRows(
      { records: [record({ reason: long }), record({ reason: "short" }), record({ file: "a.md" })] },
      undefined,
    );
    expect(rows.map((row) => row.whole)).toEqual([long, undefined, undefined]);
    expect(rows.map((row) => text(row.parts))[1]).toBe(
      "2026-10-21T09:00:00Z · passed: short · version n1:1111111111111111",
    );
    // Each record keys its row, so an open reason stays at its record when the list is read again.
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it("[SR-032/AK3] folds the older records by run, one line each with date, version and count, opening to its records", () => {
    const records = ["a", "b", "c"].map((item) => record({ item }));
    const lines = displayLines(
      {
        records,
        display: {
          shared: {},
          rows: [],
          older: [
            { date: "2026-11-08T08:00:00Z", version: "n1:1111111111111111", records: [1, 2] },
            { date: "2026-11-01T08:00:00+01:00", version: "n1:0000000000000000", records: [0] },
          ],
        },
      },
      undefined,
    );
    expect(
      lines.older.map((run) => [run.head, run.children.map((row) => text(row.parts).split(" · ")[2])]),
    ).toEqual([
      ["2026-11-08 08:00 UTC · version n1:1111111111111111 · 2 records", ["b", "c"]],
      ["2026-11-01T08:00:00+01:00 · version n1:0000000000000000 · 1 record", ["a"]],
    ]);
  });

  it("[SR-032/AK4] gives one line per criterion with result and test count, a failed or outdated one coloured and naming its views, opening to test cases and records", () => {
    const records = [
      record({ item: "mac", testCase: "shows speed", variant: "uuid-v" }),
      record({ item: "core", testCase: "shows speed" }),
      record({ item: "win", testCase: "reads unit", result: "failed", variant: "uuid-w" }),
      record({ item: "Display sample B2", method: "inspection" }),
    ];
    const lines = displayLines(
      {
        records,
        display: {
          shared: {},
          rows: [
            {
              kind: "verification",
              criterion: 1,
              status: "verified",
              views: [{ view: "core", status: "verified" }],
              cases: [
                { testCase: "shows speed", result: "passed", views: ["core", "uuid-v"], records: [0, 1] },
                { result: "passed", views: ["core"], records: [3] },
              ],
            },
            {
              kind: "verification",
              criterion: 2,
              status: "failed",
              views: [
                { view: "core", status: "verified" },
                { view: "uuid-v", status: "failed" },
                { view: "uuid-w", status: "failed" },
              ],
              cases: [{ testCase: "reads unit", result: "failed", views: ["uuid-w"], records: [2] }],
            },
            {
              kind: "verification",
              criterion: 3,
              status: "outdated",
              views: [{ view: "core", status: "outdated" }],
              cases: [],
            },
            { kind: "validation", status: "validated", cases: [] },
          ],
          older: [],
        },
      },
      [COAST],
    );
    expect(lines.rows.map((row) => [row.head, row.status])).toEqual([
      ["AK1 · verified · 2 tests", undefined],
      ["AK2 · failed in Coast, uuid-w · 1 test", "failed"],
      ["AK3 · outdated · no tests", "outdated"],
      ["Validation · validated · no tests", undefined],
    ]);
    expect(lines.rows[0]?.children.map((test) => [test.head, test.children.length])).toEqual([
      ["shows speed · passed · core, Coast", 2],
      ["inspection · Display sample B2 · passed", 1],
    ]);
    expect(lines.rows[1]?.children.map((test) => [test.head, test.status])).toEqual([
      ["reads unit · failed · uuid-w", "failed"],
    ]);
    // A row without criterion names the verification of the whole requirement.
    const whole = displayLines(
      {
        records: [],
        display: {
          shared: {},
          rows: [{ kind: "verification", status: "open", views: [], cases: [] }],
          older: [],
        },
      },
      undefined,
    );
    expect(whole.rows.map((row) => row.head)).toEqual(["Verification · open · no tests"]);
  });

  it("[SR-032/AK5] states the values the open records share once, and nothing when they share none", () => {
    const shared = (values: Partial<EvidenceListOutput["display"]["shared"]>) =>
      displayLines({ records: [], display: { shared: values, rows: [], older: [] } }, undefined).shared;
    expect(
      shared({
        date: "2026-11-09T08:48:23Z",
        item: "main@c915641 (macos-26)",
        version: "n2:30df7b1ac271d53b",
        baselines: ["Stufe 5", "Stufe 6"],
      }),
    ).toBe(
      "2026-11-09 08:48 UTC · main@c915641 (macos-26) · version n2:30df7b1ac271d53b · baselines Stufe 5, Stufe 6",
    );
    expect(shared({ date: "2026-11-09T08:48:23.120Z", baselines: [] })).toBe("2026-11-09 08:48 UTC");
    expect(shared({})).toBe(undefined);
  });

  it("names a variant that `names` lacks by its UUID", () => {
    const [line] = evidenceLines({ records: [record({ variant: "uuid-x" })] }, []);
    expect(text(line ?? [])).toBe("2026-10-21T09:00:00Z · passed · uuid-x · version n1:1111111111111111");
  });

  it("shows the Beleg as core gives it in `evidenceSource`, and none without it (#821)", () => {
    const lines = evidenceLines(
      {
        records: [
          record({ evidence: "", file: "evidence/a.md", evidenceSource: "evidence/a.md" }),
          record({ file: "b.md" }),
        ],
      },
      undefined,
    );
    expect(lines.map(text)).toEqual([
      "2026-10-21T09:00:00Z · passed · evidence/a.md · version n1:1111111111111111",
      "2026-10-21T09:00:00Z · passed · version n1:1111111111111111",
    ]);
  });

  it("notes each problem of the answer and an incomplete answer", () => {
    expect(
      evidenceNotes({
        problems: [
          {
            code: "baseline.invalid",
            severity: "error",
            message: "Invalid baseline baselines/broken.yaml: date is required",
          },
        ],
        incomplete: true,
      }),
    ).toEqual([
      "error · baseline.invalid · Invalid baseline baselines/broken.yaml: date is required",
      INCOMPLETE_NOTE,
    ]);
    expect(evidenceNotes({ problems: [], incomplete: false })).toEqual([]);
  });
});
