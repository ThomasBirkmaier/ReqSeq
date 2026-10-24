import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_RESULTS_ENV, measure } from "./index.js";

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
});
