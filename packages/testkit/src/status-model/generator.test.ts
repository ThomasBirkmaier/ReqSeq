// The generator covers every feature the property tests rely on: a fixed-seed sample must contain each of them (#1394).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OFFSETS, UNREADABLE_DATE, renderDate, statusModelElement } from "./index.js";
import { CURRENT, type ModelElement, type ModelRecord, instantOf } from "./model.js";

function elementFeatures(element: ModelElement): string[] {
  const features = [`criteria ${String(element.criteria.length)}`];
  if (element.criteria.some((criterion) => criterion.key === undefined)) {
    features.push("criterion without key");
  }
  for (const older of element.olderVersions) {
    features.push(older.criteria === undefined ? "older version unknown" : "older version known");
    if (older.criteria?.some((criterion) => criterion.key === undefined) === true) {
      features.push("older criterion without key");
    }
  }
  return features;
}

function recordFeatures(record: ModelRecord, element: ModelElement): string[] {
  const version = record.version === CURRENT ? "current" : "older";
  const features = [record.kind, version, `${record.kind} ${record.result}`];
  if (record.reason !== undefined) {
    features.push("reason");
  }
  if (record.date === UNREADABLE_DATE) {
    features.push("unreadable date");
  } else if (!record.date.endsWith("Z")) {
    features.push("offset");
  }
  if (record.criteria === undefined) {
    features.push("names no criterion");
  }
  const keys = new Set(element.criteria.map((criterion) => criterion.key));
  for (const ref of record.criteria ?? []) {
    const known = ref.by === "key" ? keys.has(ref.key) : ref.number <= element.criteria.length;
    features.push(`${version} ${ref.by} ${known ? "known" : "unknown"}`);
  }
  return features;
}

function tieFeatures(records: readonly ModelRecord[]): string[] {
  const features: string[] = [];
  for (const [index, a] of records.entries()) {
    for (const b of records.slice(index + 1)) {
      if (a.date !== b.date && instantOf(a.date) === instantOf(b.date)) {
        features.push("tie in two offsets");
      }
      if (a.date === b.date) {
        features.push("tie in one text");
      }
    }
  }
  return features;
}

function featuresOf(element: ModelElement): string[] {
  return [
    ...elementFeatures(element),
    ...element.records.flatMap((record) => recordFeatures(record, element)),
    ...tieFeatures(element.records),
  ];
}

describe("status model generator", () => {
  it("produces every feature with a fixed seed", () => {
    const seen = new Set(fc.sample(statusModelElement(), { seed: 1394, numRuns: 2000 }).flatMap(featuresOf));
    const expected = [
      ...["0", "1", "2", "3", "4"].map((count) => `criteria ${count}`),
      "criterion without key",
      "older version unknown",
      "older version known",
      "older criterion without key",
      "verification",
      "validation",
      "current",
      "older",
      "verification passed",
      "verification failed",
      "validation passed",
      "validation failed",
      "validation inconclusive",
      "reason",
      "unreadable date",
      "offset",
      "names no criterion",
      ...["current", "older"].flatMap((version) =>
        ["key", "number"].flatMap((by) => [`${version} ${by} known`, `${version} ${by} unknown`]),
      ),
      "tie in two offsets",
      "tie in one text",
    ];
    expect(expected.filter((feature) => !seen.has(feature))).toEqual([]);
  });

  it("generates no record the reader refuses", () => {
    for (const element of fc.sample(statusModelElement(), { seed: 1394, numRuns: 500 })) {
      for (const record of element.records) {
        expect(record.kind === "verification" && record.result === "inconclusive").toBe(false);
        expect(record.reason !== undefined).toBe(record.result === "inconclusive");
      }
    }
  });

  it("writes one instant in every offset", () => {
    const instants = OFFSETS.map((offset) => Date.parse(renderDate(2, offset)));
    expect(new Set(instants).size).toBe(1);
    expect(renderDate(0, "Z")).toBe("2026-11-01T10:00:00Z");
    expect(renderDate(0, "-05:00")).toBe("2026-11-01T05:00:00-05:00");
    expect(renderDate(0, "+05:30")).toBe("2026-11-01T15:30:00+05:30");
  });
});
