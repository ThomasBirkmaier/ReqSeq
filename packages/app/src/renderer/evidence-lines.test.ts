import type { DataExportEvidenceRecord, ElementName } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { elementBufferOf } from "./buffers.js";
import { INCOMPLETE_NOTE, evidenceLines, evidenceNotes, evidenceRows } from "./evidence-lines.js";
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
