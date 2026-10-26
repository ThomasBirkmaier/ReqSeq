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
