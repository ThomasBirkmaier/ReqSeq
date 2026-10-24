// Measurements of the performance suite (ADR-0011): `pnpm test:perf` sets LOGREQ_PERF_RESULTS, each
// measurement appends one JSON line there, and `scripts/perf/report.mjs` turns them into the analysis
// record `verification/performance.md`. CI runners are not the reference machine (4 cores, 16 GB), so a
// time over its threshold never fails a test; the nightly job opens an issue instead.
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
  const started = performance.now();
  const result = await run();
  const measurement: PerfMeasurement = {
    name,
    basis: options.basis,
    ms: Math.round((performance.now() - started) * 10) / 10,
    ...(options.thresholdMs === undefined ? {} : { thresholdMs: options.thresholdMs }),
  };
  const file = process.env[PERF_RESULTS_ENV];
  if (file !== undefined && file !== "") {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(measurement)}\n`);
  }
  return { result, measurement };
}
