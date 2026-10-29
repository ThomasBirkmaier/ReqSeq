// `reqseq trace matrix` end to end with evidence (SR-126, ADR-0009): the built binary on
// fixtures/SR-126/matrix (its README lists every element and its evidence), with the records read from
// the JUnit and Markdown files of the fixture. The readable output shows each requirement's verification
// status after it and the degree under `evidence`; the test case cells are in `--json`, as SR-125 keeps
// the relation cells there. The selection is complex input, so it comes with `--input`. Run after
// `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const SR = { selection: { where: { type: ["system-requirement"] } } };

const matrix = async (input: unknown, args: readonly string[] = []): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-126/matrix" });
  fixtures.push(ws);
  return run(["trace", "matrix", "--input", JSON.stringify(input), ...args], { cwd: ws.root });
};

interface TestCase {
  readonly name: string;
  readonly executed: boolean;
  readonly last?: {
    readonly result: string;
    readonly date: string;
    readonly item: string;
    readonly file: string;
  };
  readonly mark?: string;
}

interface Row {
  readonly shortId: string;
  readonly testCases?: readonly TestCase[];
  readonly verification?: readonly { readonly view: string; readonly status: string }[];
}

const rowsOf = async (input: unknown): Promise<readonly Row[]> => {
  const result = await matrix(input, ["--json"]);
  expect([result.code, result.stderr]).toEqual([0, ""]);
  return (JSON.parse(result.stdout) as { rows: readonly Row[] }).rows;
};

/** The rows of the readable output of all system requirements (AK1, AK3). */
const ROWS = [
  "rows:",
  "  SR-126b01  draft  Show wind speed  [verification: core verified]",
  "  SR-126b02  draft  Log wind speed  [verification: core failed]",
  "  SR-126b03  draft  Show the wind trend  [verification: core outdated]",
  "  SR-126b04  draft  Show gusts  [verification: core open]",
  "  SR-126b05  draft  Show the wind on the display  [verification: core verified]",
  "  SR-126b06  draft  Warn of strong wind  [verification: core open]",
  "  SR-126b07  draft  Show the wind direction  [verification: core indirect]",
  "  SR-126b08  draft  Show the mean direction  [verification: core verified]",
  "  SR-126b09  draft  Show the direction range  [verification: core verified]",
  "  SR-126b10  obsolete  Show the old reading  [verification: core verified]",
].join("\n");

/** The header of the evidence columns in the readable output of all system requirements (AK4). */
const EVIDENCE = [
  "evidence:",
  "  view: core",
  "  degree:",
  "    share: 55.5 %",
  "    total: 9",
  "    counts:",
  "      open: 2",
  "      verified: 4",
  "      indirect: 1",
  "      failed: 1",
  "      outdated: 1",
  "",
].join("\n");

describe("reqseq trace matrix with evidence (SR-126)", () => {
  it("[SR-126/AK1] reqseq trace matrix --json gives the test cases and the verification status read from JUnit and Markdown record files", async () => {
    const rows = await rowsOf({ selection: { ids: ["SR-126b01", "SR-126b05", "N-126a01"] } });
    expect(rows.map((r) => [r.shortId, r.testCases, r.verification])).toEqual([
      ["N-126a01", undefined, undefined],
      [
        "SR-126b01",
        [
          {
            name: "test_speed[SR-126b01]",
            className: "tests.test_wind",
            executed: true,
            last: expect.objectContaining({
              result: "passed",
              date: "2026-10-22T09:00:00Z",
              item: "build-602",
              file: "evidence/ci/run-2.xml",
            }) as unknown,
          },
        ],
        [{ view: "core", status: "verified" }],
      ],
      // Verified by an inspection record (Markdown), which has no test case.
      ["SR-126b05", [], [{ view: "core", status: "verified" }]],
    ]);
  });

  it("[SR-126/AK1] reqseq trace matrix prints the verification status after each requirement", async () => {
    const result = await matrix(SR);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(`${ROWS}\ntotal: 10\n`);
  });

  it("[SR-126/AK2] reqseq trace matrix --json marks the cells read from record files", async () => {
    const rows = await rowsOf(SR);
    const marks = rows.map((r) => [
      r.shortId,
      (r.testCases ?? []).map((t) => [t.name, t.last?.result, t.last?.date.slice(0, 10), t.mark]),
    ]);
    expect(marks.slice(0, 6)).toEqual([
      ["SR-126b01", [["test_speed[SR-126b01]", "passed", "2026-10-22", undefined]]],
      ["SR-126b02", [["test_log[SR-126b02]", "failed", "2026-10-22", "failed"]]],
      ["SR-126b03", [["test_trend[SR-126b03]", "passed", "2026-10-21", "outdated"]]],
      ["SR-126b04", [["test_gusts[SR-126b04]", undefined, undefined, "not-executed"]]],
      ["SR-126b05", []],
      ["SR-126b06", []],
    ]);
  });

  it("[SR-126/AK3] reqseq trace matrix prints an indirectly verified requirement as indirect", async () => {
    const result = await matrix({ selection: { ids: ["SR-126b07"] } });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(
      "rows:\n  SR-126b07  draft  Show the wind direction  [verification: core indirect]\n",
    );
  });

  it("[SR-126/AK4] reqseq trace matrix prints the degree above the status column as 55.5 % with the count per status", async () => {
    const result = await matrix({ ...SR, limit: 2 });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    // The degree is of the whole selection, not of the page of two rows, and comes before the rows
    // that hold the status (AK4 „über der Spalte des Nachweisstatus“).
    expect(result.stdout).toContain(`${EVIDENCE}rows:\n`);
    expect(result.stdout).toContain("total: 10\n");
  });
});
