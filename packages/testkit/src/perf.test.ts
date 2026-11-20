import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ELEMENTS,
  DEFAULT_RELATIONS,
  MIN_PERF_ELEMENTS,
  PERF_ELEMENTS_ENV,
  PERF_RESULTS_ENV,
  THRESHOLD_FAILURE,
  measure,
  measureMedian,
  measurePeakMemory,
  memoryIncrease,
  perfSize,
  recordValue,
  scaledCount,
  thresholdLimit,
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
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-perf-"));
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
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-perf-"));
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
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-perf-"));
    const file = path.join(folder, "perf.jsonl");
    vi.stubEnv(PERF_RESULTS_ENV, file);
    await recordValue("slowest", 321.46, { basis: "SR-098 AK1", thresholdMs: 300 });
    expect(JSON.parse(fs.readFileSync(file, "utf8")) as unknown).toEqual({
      name: "slowest",
      basis: "SR-098 AK1",
      ms: 321.5,
      thresholdMs: 300,
    });
    expect(await recordValue("splits", 2, { basis: "SR-211 AK1", thresholdMs: 0, unit: "count" })).toEqual({
      name: "splits",
      basis: "SR-211 AK1",
      ms: 2,
      thresholdMs: 0,
      unit: "count",
    });
    expect(await recordValue("none ended", 0, { basis: "SR-211 AK1", failed: "every run split" })).toEqual({
      name: "none ended",
      basis: "SR-211 AK1",
      ms: 0,
      failed: "every run split",
    });
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("records nothing in a run smaller than the N-036 size", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-perf-"));
    const file = path.join(folder, "perf.jsonl");
    vi.stubEnv(PERF_RESULTS_ENV, file);
    vi.stubEnv(PERF_ELEMENTS_ENV, "500");
    expect((await recordValue("small", 5, { basis: "N-036", thresholdMs: 1 })).ms).toBe(5);
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(folder, { recursive: true, force: true });
  });
});

describe("perfSize", () => {
  it("is the N-036 size without the variable, and asserts thresholds only there", () => {
    vi.stubEnv(PERF_ELEMENTS_ENV, undefined);
    expect(perfSize()).toEqual({ elements: DEFAULT_ELEMENTS, relations: DEFAULT_RELATIONS, full: true });
    expect(thresholdLimit(300)).toBe(300);
    expect(scaledCount(5_000)).toBe(5_000);
    vi.stubEnv(PERF_ELEMENTS_ENV, " ");
    expect(perfSize(1_000)).toEqual({ elements: DEFAULT_ELEMENTS, relations: DEFAULT_RELATIONS, full: true });
    vi.stubEnv(PERF_ELEMENTS_ENV, String(DEFAULT_ELEMENTS));
    expect(perfSize().full).toBe(true);
  });

  it("takes a smaller size with four relations per element, raised to a test's minimum, without thresholds", () => {
    vi.stubEnv(PERF_ELEMENTS_ENV, "500");
    expect(perfSize()).toEqual({ elements: 500, relations: 2_000, full: false });
    expect(perfSize(2_000)).toEqual({ elements: 2_000, relations: 8_000, full: false });
    expect(perfSize(DEFAULT_ELEMENTS + 1)).toEqual({
      elements: DEFAULT_ELEMENTS,
      relations: DEFAULT_RELATIONS,
      full: false,
    });
    expect(thresholdLimit(300)).toBe(Number.POSITIVE_INFINITY);
    expect([scaledCount(5_000), scaledCount(1), scaledCount(5_000, perfSize(1_000))]).toEqual([50, 1, 100]);
    vi.stubEnv(PERF_ELEMENTS_ENV, String(MIN_PERF_ELEMENTS));
    expect(perfSize().elements).toBe(MIN_PERF_ELEMENTS);
  });

  it("refuses a size that is no whole number from the minimum to the N-036 size", () => {
    for (const value of ["5", "50001", "1.5", "many"]) {
      vi.stubEnv(PERF_ELEMENTS_ENV, value);
      expect(() => perfSize()).toThrow(
        `${PERF_ELEMENTS_ENV} must be a whole number from 6 to 50000: ${value}`,
      );
    }
  });
});

describe("measurePeakMemory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives the result, the time and the heap before, at its peak and the resident peak", async () => {
    let kept: number[] = [];
    const peak = await measurePeakMemory(
      async () => {
        kept = Array.from({ length: 200_000 }, (_, i) => i);
        // A turn of the event loop long enough for samples.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return kept.length;
      },
      { sampleMs: 1 },
    );
    expect(peak.result).toBe(200_000);
    expect(peak.ms).toBeGreaterThan(0);
    expect(peak.peakHeapMb).toBeGreaterThanOrEqual(peak.heapBeforeMb);
    expect(peak.peakHeapTotalMb).toBeGreaterThanOrEqual(peak.heapTotalBeforeMb);
    expect(peak.peakRssMb).toBeGreaterThanOrEqual(peak.rssBeforeMb);
    expect(peak.processMaxRssMb).toBeGreaterThanOrEqual(peak.peakRssMb - 1);
    expect(memoryIncrease(peak)).toBe(
      `heap in use +${String(peak.peakHeapMb - peak.heapBeforeMb)} MB (from ${String(peak.heapBeforeMb)} MB), heap reserved +${String(peak.peakHeapTotalMb - peak.heapTotalBeforeMb)} MB, resident memory +${String(peak.peakRssMb - peak.rssBeforeMb)} MB (from ${String(peak.rssBeforeMb)} MB)`,
    );
    expect(kept).toHaveLength(200_000);
  });

  it("collects garbage first when the suite exposes gc, and stops sampling when the run fails", async () => {
    const gc = vi.fn();
    vi.stubGlobal("gc", gc);
    const clear = vi.spyOn(globalThis, "clearInterval");
    await expect(
      measurePeakMemory(() => {
        throw new Error("failed run");
      }),
    ).rejects.toThrow("failed run");
    expect(gc).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    clear.mockRestore();
  });
});
