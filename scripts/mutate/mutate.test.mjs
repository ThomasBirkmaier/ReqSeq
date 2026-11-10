import path from "node:path";
import { describe, expect, it } from "vitest";
import { format, packagesOf, parseArgs, strykerOptions, summarize, testGlobs } from "./mutate.mjs";

const ROOT = path.resolve("/repo");
const mutant = (status, line, extra = {}) => ({
  fileName: path.join(ROOT, "packages/core/src/a.ts"),
  status,
  mutatorName: "EqualityOperator",
  replacement: "a < b",
  location: { start: { line, column: 3 }, end: { line, column: 9 } },
  ...extra,
});

describe("pnpm mutate", () => {
  it("reads the files, the test globs and the concurrency", () => {
    expect(
      parseArgs(["./packages\\core\\src\\a.ts", "--tests", "packages/core/src/x/**", "--concurrency", "2"]),
    ).toEqual({ files: ["packages/core/src/a.ts"], tests: ["packages/core/src/x/**"], concurrency: 2 });
    expect(() => parseArgs([])).toThrow("at least one source file");
    expect(() => parseArgs(["a.ts", "--concurrency", "0"])).toThrow("whole number");
    expect(() => parseArgs(["a.ts", "--tests"])).toThrow("needs a glob");
    expect(() => parseArgs(["a.ts", "--bail"])).toThrow("unknown option --bail");
  });

  it("takes the unit tests of the packages of the files and refuses tests and files outside src/", () => {
    expect(
      packagesOf(["packages/core/src/a.ts", "packages/cli/src/b.ts", "packages/core/src/c/d.ts"]),
    ).toEqual(["cli", "core"]);
    expect(testGlobs(["core"])).toEqual([
      "packages/core/src/**/*.test.ts",
      "packages/core/test/**/*.test.ts",
    ]);
    expect(() => packagesOf(["packages/core/src/a.test.ts"])).toThrow("no source file");
    expect(() => packagesOf(["scripts/x.mjs"])).toThrow("no source file");
  });

  it("runs in forks, without static mutants, with the files to mutate", () => {
    const options = strykerOptions({ files: ["packages/core/src/a.ts"], tests: [] });
    expect(options).toMatchObject({
      mutate: ["packages/core/src/a.ts"],
      vitest: { pool: "forks" },
      ignoreStatic: true,
      coverageAnalysis: "perTest",
    });
    expect(options).not.toHaveProperty("concurrency");
  });

  it("scores per file and lists the survivors without static mutants", () => {
    const summary = summarize(
      [
        mutant("Killed", 1),
        mutant("Timeout", 2),
        mutant("Survived", 3),
        mutant("NoCoverage", 4, { replacement: undefined }),
        mutant("Survived", 5, { static: true }),
        mutant("Ignored", 6, { static: true }),
        mutant("RuntimeError", 7),
      ],
      ROOT,
    );
    expect(summary.total).toEqual({
      Killed: 1,
      Timeout: 1,
      Survived: 1,
      NoCoverage: 1,
      Errors: 1,
      Ignored: 2,
    });
    expect(summary.survivors).toEqual([
      "packages/core/src/a.ts:3:3 EqualityOperator -> a < b",
      "packages/core/src/a.ts:4:3 EqualityOperator",
    ]);
    const text = format(summary);
    expect(text).toContain("packages/core/src/a.ts   50.0  killed 1  timeout 1  survived 1  no coverage 1");
    expect(text).toContain("Survivors (2):");
    expect(format(summarize([], ROOT))).toContain("total    n/a");
  });
});
