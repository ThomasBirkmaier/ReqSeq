// `reqseq evidence degree` end to end (SR-037, ADR-0009): the built binary on fixtures/SR-037/degree (its
// README lists every element, its record, its status and its packages), with the records read from the
// Markdown files of the fixture, as readable output and as JSON. The selection is complex input, so it
// comes with `--input`. Run after `pnpm build` with `pnpm test:e2e`. The numbers of a package page's line
// (SR-112 AK3) come from `evidence coverage` and `evidence degree` with `selection.package`.
import type { EvidenceCoverageOutput, EvidenceDegreeOutput } from "@reqseq/core";
import { packageSummaryText } from "@reqseq/core";
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

const degree = async (input: unknown, args: readonly string[] = []): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-037/degree" });
  fixtures.push(ws);
  return run(["evidence", "degree", "--input", JSON.stringify(input), ...args], { cwd: ws.root });
};

/** The readable output of P1 (AK1), and of P3 (AK3). */
const P1 = [
  "degree:",
  "  share: 60 %",
  "  total: 10",
  "  counts:",
  "    open: 2",
  "    verified: 6",
  "    indirect: 0",
  "    failed: 1",
  "    outdated: 1",
  "view: core",
  "",
].join("\n");

describe("reqseq evidence degree (SR-037)", () => {
  it("[SR-037/AK1] reqseq evidence degree prints 60 % and the count per status for a package", async () => {
    const result = await degree({ selection: { package: "PKG-00d001" } });
    expect([result.code, result.stderr, result.stdout]).toEqual([0, "", P1]);
  });

  it("[SR-037/AK2] reqseq evidence degree --json counts indirect requirements as verified and apart", async () => {
    const result = await degree({ selection: { package: "PKG-00d002" } }, ["--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(JSON.parse(result.stdout)).toEqual({
      degree: { share: 0.6, total: 5, counts: { open: 1, verified: 2, indirect: 1, failed: 1, outdated: 0 } },
      view: "core",
      incomplete: false,
    });
  });

  it("[SR-037/AK3] reqseq evidence degree leaves out the requirements with an obsolete status", async () => {
    const result = await degree({ selection: { package: "PKG-00d003" } });
    expect([result.code, result.stderr, result.stdout]).toEqual([0, "", P1]);
  });

  it("prints 64.2 % for the whole workspace: 9 of 14, rounded down", async () => {
    const result = await degree({});
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain("degree:\n  share: 64.2 %\n  total: 14\n");
  });
});

describe("the numbers of a package page (SR-112)", () => {
  it("[SR-112/AK3] reqseq evidence coverage and evidence degree with selection.package give the numbers of the package page's line", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-037/degree" });
    fixtures.push(ws);
    const input = JSON.stringify({ selection: { package: "PKG-00d003" } });
    const coverage = await run(["evidence", "coverage", "--input", input, "--json"], { cwd: ws.root });
    const degree = await run(["evidence", "degree", "--input", input, "--json"], { cwd: ws.root });
    expect([coverage.code, coverage.stderr, degree.code, degree.stderr]).toEqual([0, "", 0, ""]);
    const levels = (JSON.parse(coverage.stdout) as EvidenceCoverageOutput).levels;
    expect(levels.map(({ type, total, withEvidence }) => [type, total, withEvidence])).toEqual([
      ["need", 1, undefined],
      ["system-requirement", 10, 8],
    ]);
    const output = JSON.parse(degree.stdout) as EvidenceDegreeOutput;
    expect(packageSummaryText(levels, output.degree)).toBe(
      "Coverage 8 of 10 with evidence · Degree 60 % (6 verified, 1 failed, 1 outdated, 2 open)",
    );
  });
});
