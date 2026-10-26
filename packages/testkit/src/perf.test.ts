import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERF_RESULTS_ENV,
  THRESHOLD_FAILURE,
  measure,
  measureMedian,
  recordValue,
  thresholdMessage,
} from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("measure", () => {
  it("returns the result and the time, and records nothing without a results file", async () => {
    vi.stubEnv(PERF_RESULTS_ENV, "");
    const { result, measurement } = await measure("sum", () => 1 + 2, { basis: "N-036" });
    expect(result).toBe(3);
    expect(measurement).toEqual({ name: "sum", basis: "N-036", ms: expect.any(Number) as number });
    expect(measurement.ms).toBeGreaterThanOrEqual(0);
    vi.stubEnv(PERF_RESULTS_ENV, undefined);
    expect((await measure("again", () => "x", { basis: "N-036" })).result).toBe("x");
  });

  it("appends one JSON line per measurement to the results file, creating its folder", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-perf-"));
    const file = path.join(folder, "nested", "perf.jsonl");
    vi.stubEnv(PERF_RESULTS_ENV, file);
    await measure("first", async () => Promise.resolve("done"), { basis: "SR-082 AK2", thresholdMs: 30_000 });
    await measure("second", () => undefined, { basis: "N-036" });
    const lines = fs
      .readFileSync(file, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([
      { name: "first", basis: "SR-082 AK2", ms: expect.any(Number) as number, thresholdMs: 30_000 },
      { name: "second", basis: "N-036", ms: expect.any(Number) as number },
    ]);
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("names the measurement in the message of a threshold assertion, after the marker", () => {
    expect(thresholdMessage({ name: "check", basis: "SR-020 AK1", ms: 61_000, thresholdMs: 60_000 })).toBe(
      `${THRESHOLD_FAILURE} check`,
    );
  });
});

describe("measureMedian", () => {
  it("runs as often as asked and records one line with the median time", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-perf-"));
    const file = path.join(folder, "perf.jsonl");
    vi.stubEnv(PERF_RESULTS_ENV, file);
    let calls = 0;
    const { result, measurement, times } = await measureMedian(
      "search",
      async () => {
        calls += 1;
        return Promise.resolve(calls);
      },
      { basis: "SR-098 AK1", thresholdMs: 300, runs: 4 },
    );
    expect(result).toBe(4);
    expect(times).toHaveLength(4);
    const sorted = [...times].sort((a, b) => a - b);
    expect(measurement).toEqual({ name: "search", basis: "SR-098 AK1", ms: sorted[2], thresholdMs: 300 });
    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([measurement]);
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("takes one run and refuses fewer or a fraction", async () => {
    vi.stubEnv(PERF_RESULTS_ENV, "");
    expect((await measureMedian("once", () => "x", { basis: "N-036", runs: 1 })).times).toHaveLength(1);
    await expect(measureMedian("none", () => "x", { basis: "N-036", runs: 0 })).rejects.toThrow(
      "runs must be a whole number from 1: 0",
    );
    await expect(measureMedian("half", () => "x", { basis: "N-036", runs: 1.5 })).rejects.toThrow("1.5");
  });
});

describe("recordValue", () => {
  it("records the value given, rounded to 0.1 ms, with its threshold, and nothing without a results file", async () => {
    vi.stubEnv(PERF_RESULTS_ENV, "");
    expect(await recordValue("none", 12.34, { basis: "N-036" })).toEqual({
      name: "none",
      basis: "N-036",
      ms: 12.3,
    });
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-perf-"));
    const file = path.join(folder, "perf.jsonl");
    vi.stubEnv(PERF_RESULTS_ENV, file);
    await recordValue("slowest", 321.46, { basis: "SR-098 AK1", thresholdMs: 300 });
    expect(JSON.parse(fs.readFileSync(file, "utf8")) as unknown).toEqual({
      name: "slowest",
      basis: "SR-098 AK1",
      ms: 321.5,
      thresholdMs: 300,
    });
    fs.rmSync(folder, { recursive: true, force: true });
  });
});
