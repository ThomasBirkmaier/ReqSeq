// Measurements of the performance suite (ADR-0011): `pnpm test:perf` sets LOGREQ_PERF_RESULTS, each
// measurement appends one JSON line there, and `scripts/perf/report.mjs` turns them into the analysis
// record `verification/performance.md`. `measure` itself never fails: a test tagged `[SR-xxx/AKn]`
// asserts its threshold (see `thresholdMessage`), an untagged measurement only records its time.
import fs from "node:fs/promises";
import path from "node:path";

/** Environment variable with the file that measurements are appended to (JSON lines). */
export const PERF_RESULTS_ENV = "LOGREQ_PERF_RESULTS";

export interface MeasureOptions {
  /** What the threshold comes from, e.g. `N-036, SR-082 AK2`. */
  readonly basis: string;
  /** The target time; a measurement above it is reported as exceeded. */
  readonly thresholdMs?: number;
}

export interface PerfMeasurement {
  readonly name: string;
  readonly basis: string;
  /** Wall-clock time, rounded to 0.1 ms. */
  readonly ms: number;
  readonly thresholdMs?: number;
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
  };
  const file = process.env[PERF_RESULTS_ENV];
  if (file !== undefined && file !== "") {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(measurement)}\n`);
  }
  return measurement;
};

/**
 * Start of the assertion message of a threshold that a test tagged `[SR-xxx/AKn]` asserts (ADR-0011).
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
 * Runs `run` once and measures its time and its memory (review of #561, N4: peak heap, not only time):
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
