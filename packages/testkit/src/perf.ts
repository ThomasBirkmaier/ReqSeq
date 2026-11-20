// Measurements of the performance suite (ADR-0011): `pnpm test:perf` sets REQSEQ_PERF_RESULTS, each
// measurement appends one JSON line there, and `scripts/perf/report.mjs` turns them into the analysis
// record `verification/performance.md`. `measure` itself never fails: a test tagged `[SR-xxx/AK-<key>]`
// asserts its threshold (see `thresholdMessage`), an untagged measurement only records its time.
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ELEMENTS, DEFAULT_RELATIONS } from "./large-workspace.js";

/** Environment variable with the file that measurements are appended to (JSON lines). */
export const PERF_RESULTS_ENV = "REQSEQ_PERF_RESULTS";

/**
 * Environment variable with the number of elements of the generated workspace (#2037). Unset or empty: the
 * N-036 size, `DEFAULT_ELEMENTS`. A smaller size runs the suite's other assertions (counts, findings, output
 * shapes) in minutes; such a run neither records times nor asserts a threshold (`perfSize`).
 */
export const PERF_ELEMENTS_ENV = "REQSEQ_PERF_ELEMENTS";

/** The smallest size `PERF_ELEMENTS_ENV` takes: the generator writes at least one element of each of the six types. */
export const MIN_PERF_ELEMENTS = 6;

/** The workspace size of a performance test (`perfSize`). */
export interface PerfSize {
  readonly elements: number;
  /** Relation targets: four per element, the ratio of N-036 (200,000 for 50,000). */
  readonly relations: number;
  /** The run is at the N-036 size: only such a run records times and asserts thresholds (ADR-0011). */
  readonly full: boolean;
}

/**
 * The workspace size of a performance test: the size `PERF_ELEMENTS_ENV` asks for, raised to `minimum` for a
 * test whose data needs more elements than a small run gives, and never above the N-036 size. Throws on a
 * value that is no whole number from `MIN_PERF_ELEMENTS` to `DEFAULT_ELEMENTS`.
 */
export const perfSize = (minimum = MIN_PERF_ELEMENTS): PerfSize => {
  const raw = process.env[PERF_ELEMENTS_ENV];
  const asked = raw === undefined || raw.trim() === "" ? DEFAULT_ELEMENTS : Number(raw);
  if (!Number.isInteger(asked) || asked < MIN_PERF_ELEMENTS || asked > DEFAULT_ELEMENTS) {
    throw new Error(
      `${PERF_ELEMENTS_ENV} must be a whole number from ${String(MIN_PERF_ELEMENTS)} to ${String(DEFAULT_ELEMENTS)}: ${String(raw)}`,
    );
  }
  const elements = Math.min(DEFAULT_ELEMENTS, Math.max(asked, minimum));
  return {
    elements,
    relations: (elements * DEFAULT_RELATIONS) / DEFAULT_ELEMENTS,
    full: asked === DEFAULT_ELEMENTS,
  };
};

/**
 * A count a test takes at the N-036 size (elements to change, a page far on, items of a pass), scaled to the
 * size of `size` and rounded, at least 1. Unchanged at the N-036 size.
 */
export const scaledCount = (count: number, size: PerfSize = perfSize()): number =>
  Math.max(1, Math.round((count * size.elements) / DEFAULT_ELEMENTS));

/**
 * The limit a test asserts a time against (ADR-0011): `ms` in a run at the N-036 size, none (infinity) in a
 * smaller run, whose times say nothing about the threshold.
 */
export const thresholdLimit = (ms: number): number => (perfSize().full ? ms : Number.POSITIVE_INFINITY);

export interface MeasureOptions {
  /** What the threshold comes from, e.g. `N-036, SR-082 AK2`. */
  readonly basis: string;
  /** The target time; a measurement above it is reported as exceeded. */
  readonly thresholdMs?: number;
  /** The value is a count, not a time: the record writes it, and its threshold, without a unit. */
  readonly unit?: "count";
  /** Why the measurement has no value (every run of it failed): the record reports it as exceeded. */
  readonly failed?: string;
}

export interface PerfMeasurement {
  readonly name: string;
  readonly basis: string;
  /** Wall-clock time, rounded to 0.1 ms; with `unit: "count"` a count; 0 when `failed`. */
  readonly ms: number;
  readonly thresholdMs?: number;
  readonly unit?: "count";
  readonly failed?: string;
}

/** Runs `run` once, measures its wall-clock time and records it (see `PERF_RESULTS_ENV`). */
export async function measure<T>(
  name: string,
  run: () => T | Promise<T>,
  options: MeasureOptions,
): Promise<{ readonly result: T; readonly measurement: PerfMeasurement }> {
  const times: number[] = [];
  const result = await timed(run, times);
  return { result, measurement: await record(name, Number(times[0]), options) };
}

/** What `measureMedian` takes: `measure`'s options and how often to run. */
export interface MeasureMedianOptions extends MeasureOptions {
  /** Runs, at least 1; the median of an even number is the upper of the two middle times. */
  readonly runs: number;
}

/**
 * Runs `run` `options.runs` times one after the other and records one measurement whose time is the
 * median of the runs (see `PERF_RESULTS_ENV`): a latency that single runs on a shared machine blur
 * with pauses of the garbage collector or the scheduler. Gives the result of the last run, the
 * measurement and every time in run order.
 */
export async function measureMedian<T>(
  name: string,
  run: () => T | Promise<T>,
  options: MeasureMedianOptions,
): Promise<{ readonly result: T; readonly measurement: PerfMeasurement; readonly times: readonly number[] }> {
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error(`runs must be a whole number from 1: ${String(options.runs)}`);
  }
  const times: number[] = [];
  let result = await timed(run, times);
  while (times.length < options.runs) {
    result = await timed(run, times);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const measurement = await record(name, Number(sorted[Math.floor(sorted.length / 2)]), options);
  return { result, measurement, times };
}

/**
 * Records a time that the test took itself, e.g. the slowest of many runs, rounded to 0.1 ms (see
 * `PERF_RESULTS_ENV`); `measure` would time the call that gives it, not the value.
 */
export const recordValue = async (
  name: string,
  ms: number,
  options: MeasureOptions,
): Promise<PerfMeasurement> => record(name, Math.round(ms * 10) / 10, options);

/** Runs `run` once and appends its time, rounded to 0.1 ms, to `times`. */
const timed = async <T>(run: () => T | Promise<T>, times: number[]): Promise<T> => {
  const started = performance.now();
  const result = await run();
  times.push(Math.round((performance.now() - started) * 10) / 10);
  return result;
};

/** Records a measurement of `ms` (see `PERF_RESULTS_ENV`). */
const record = async (name: string, ms: number, options: MeasureOptions): Promise<PerfMeasurement> => {
  const measurement: PerfMeasurement = {
    name,
    basis: options.basis,
    ms,
    ...(options.thresholdMs === undefined ? {} : { thresholdMs: options.thresholdMs }),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.failed === undefined ? {} : { failed: options.failed }),
  };
  const file = process.env[PERF_RESULTS_ENV];
  // A smaller run (`perfSize`) records nothing: the record verification/performance.md is of the N-036 size only.
  if (file !== undefined && file !== "" && perfSize().full) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(measurement)}\n`);
  }
  return measurement;
};

/**
 * Start of the assertion message of a threshold that a test tagged `[SR-xxx/AK-<key>]` asserts (ADR-0011).
 * `scripts/perf/report.mjs --junit` tells these failures from all others by it: a suite whose only
 * failures are thresholds still recorded every measurement, so its record is complete.
 */
export const THRESHOLD_FAILURE = "perf threshold exceeded:";

/** The message for `expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(...)`. */
export const thresholdMessage = (measurement: PerfMeasurement): string =>
  `${THRESHOLD_FAILURE} ${measurement.name}`;

/** What `measurePeakMemory` found. Memory in MB (10^6 bytes), rounded to whole MB. */
export interface PeakMemory<T> {
  readonly result: T;
  /** Wall-clock time, rounded to 0.1 ms. */
  readonly ms: number;
  /** Heap in use before the run, after a full collection when `--expose-gc` gives `gc`. */
  readonly heapBeforeMb: number;
  /** The highest heap in use seen: sampled every `sampleMs` between turns of the event loop and at the end. */
  readonly peakHeapMb: number;
  /** Heap reserved (`heapTotal`) before, and the highest seen; it does not shrink before the next collection. */
  readonly heapTotalBeforeMb: number;
  readonly peakHeapTotalMb: number;
  /** Resident memory of the process before the run, and the highest seen while it ran (sampled as the heap). */
  readonly rssBeforeMb: number;
  readonly peakRssMb: number;
  /** The high-water mark of the process since it started (`process.resourceUsage().maxRSS`), for comparison. */
  readonly processMaxRssMb: number;
}

const MB = 1e6;
const mb = (bytes: number): number => Math.round(bytes / MB);

/**
 * Runs `run` once and measures its time and its memory (review of ThomasBirkmaier/ReqSeq-archive#561, N4: peak heap, not only time):
 * heap in use, heap reserved and resident memory before (collected first when the suite runs with
 * `--expose-gc`) and the highest values sampled while it runs. A synchronous stretch inside `run` is
 * sampled only when it returns to the event loop, so the peaks are lower bounds; reserved heap and
 * resident memory do not shrink before a collection, so they keep most of such a stretch. Records
 * nothing: the caller records what it needs (`recordValue` with `memoryIncrease`).
 */
export async function measurePeakMemory<T>(
  run: () => T | Promise<T>,
  options: { readonly sampleMs?: number } = {},
): Promise<PeakMemory<T>> {
  (globalThis as { gc?: () => void }).gc?.();
  const before = process.memoryUsage();
  const peak = { heapUsed: before.heapUsed, heapTotal: before.heapTotal, rss: before.rss };
  const sample = (): void => {
    const now = process.memoryUsage();
    peak.heapUsed = Math.max(peak.heapUsed, now.heapUsed);
    peak.heapTotal = Math.max(peak.heapTotal, now.heapTotal);
    peak.rss = Math.max(peak.rss, now.rss);
  };
  const timer = setInterval(sample, options.sampleMs ?? 5);
  const started = performance.now();
  try {
    const result = await run();
    const ms = Math.round((performance.now() - started) * 10) / 10;
    sample();
    return {
      result,
      ms,
      heapBeforeMb: mb(before.heapUsed),
      peakHeapMb: mb(peak.heapUsed),
      heapTotalBeforeMb: mb(before.heapTotal),
      peakHeapTotalMb: mb(peak.heapTotal),
      rssBeforeMb: mb(before.rss),
      peakRssMb: mb(peak.rss),
      // `maxRSS` is in kilobytes (1024 bytes) on every platform.
      processMaxRssMb: mb(process.resourceUsage().maxRSS * 1024),
    };
  } finally {
    clearInterval(timer);
  }
}

/**
 * The memory a call added, for the name of a recorded row: the increase of heap in use, heap
 * reserved and resident memory over the values before it, with the values before in brackets.
 */
export const memoryIncrease = (peak: Omit<PeakMemory<unknown>, "result" | "ms">): string =>
  `heap in use +${String(peak.peakHeapMb - peak.heapBeforeMb)} MB (from ${String(peak.heapBeforeMb)} MB), heap reserved +${String(peak.peakHeapTotalMb - peak.heapTotalBeforeMb)} MB, resident memory +${String(peak.peakRssMb - peak.rssBeforeMb)} MB (from ${String(peak.rssBeforeMb)} MB)`;
