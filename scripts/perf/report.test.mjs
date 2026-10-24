import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exceeded, machineOf, main, parseResults, renderReport } from "./report.mjs";

const COLD = { name: "cold load", basis: "N-036, SR-082 AK2", ms: 40867.9, thresholdMs: 30000 };
const CHECK = { name: "checks", basis: "SR-020", ms: 1289.3, thresholdMs: 60000 };
const WRITE = { name: "write", basis: "D-055 generator", ms: 5316.2 };
const MACHINE = { os: "Linux 6 (x64)", cores: 4, memoryGb: 16, node: "v22.12.0" };

const folders = [];
const temp = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-perf-report-"));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

describe("perf report", () => {
  it("reads one measurement per line and rejects anything else", () => {
    expect(parseResults(`${JSON.stringify(COLD)}\n\n${JSON.stringify(WRITE)}\n`)).toEqual([COLD, WRITE]);
    expect(() => parseResults('{"name":"x"}\n')).toThrow(/line 1: not a measurement/);
    expect(() => parseResults("null\n")).toThrow(/not a measurement/);
  });

  it("finds the times over their threshold", () => {
    expect(exceeded([COLD, CHECK, WRITE])).toEqual([COLD]);
  });

  it("writes a table with basis, time, threshold and result, and the run it comes from", () => {
    const report = renderReport({
      measurements: [COLD, CHECK, WRITE],
      machine: MACHINE,
      commit: "abc123",
      runUrl: "https://github.com/o/r/actions/runs/1",
      date: "2026-10-24",
    });
    expect(report).toContain("Verification method: Analyse");
    expect(report).toContain("**Not confirmed.**");
    expect(report).toContain("- Commit: abc123\n- Run: https://github.com/o/r/actions/runs/1\n");
    expect(report).toContain("- Machine: Linux 6 (x64), 4 cores, 16 GB, Node v22.12.0");
    expect(report).toContain("| cold load | N-036, SR-082 AK2 | 40.9 s | 30.0 s | **exceeded** |");
    expect(report).toContain("| checks | SR-020 | 1.3 s | 60.0 s | within |");
    expect(report).toContain("| write | D-055 generator | 5.3 s |  | no threshold |");
    expect(report).toContain("Result: 1 of 3 measurements over their threshold: cold load.");
    const within = renderReport({ measurements: [CHECK], machine: MACHINE, date: "2026-10-24" });
    expect(within).toContain("- Commit: unknown\n- Machine");
    expect(within).toContain("Result: every measured time is within its threshold.");
  });

  it("describes the machine it runs on", () => {
    expect(machineOf()).toEqual({
      os: expect.any(String),
      cores: os.cpus().length,
      memoryGb: expect.any(Number),
      node: process.version,
    });
  });

  it("writes the record, the step summary and the number exceeded for the workflow", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const folder = temp();
    const results = path.join(folder, "perf.jsonl");
    fs.writeFileSync(results, `${JSON.stringify(COLD)}\n${JSON.stringify(CHECK)}\n`);
    const out = path.join(folder, "verification", "performance.md");
    const summary = path.join(folder, "summary.md");
    const output = path.join(folder, "output.txt");
    const args = [
      "--results",
      results,
      "--out",
      out,
      "--commit",
      "abc",
      "--summary",
      summary,
      "--github-output",
      output,
    ];
    expect(main(args, new Date("2026-10-24T03:00:00Z"))).toBe(1);
    const report = fs.readFileSync(out, "utf8");
    expect(report).toContain("- Date: 2026-10-24\n- Commit: abc\n- Machine");
    expect(fs.readFileSync(summary, "utf8")).toBe(report);
    expect(fs.readFileSync(output, "utf8")).toBe("exceeded=1\n");
    fs.writeFileSync(results, "");
    expect(() => main(["--results", results, "--out", out])).toThrow(/has no measurements/);
  });
});
