// JUnit XML as records (SR-093) end to end: the built binary reads an enriched JUnit file from the
// evidence folder of the workspace file (fixtures/SR-093/junit). Until the status commands are in
// (SR-031), the records show through the check of outdated evidence in `reqseq workspace check`
// (SR-025 AK4), which names the requirement, the JUnit file and the line of the test case.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

interface Problem {
  readonly code: string;
  readonly file?: string;
  readonly line?: number;
  readonly elementId?: string;
  readonly storedVersion?: string;
  readonly currentVersion?: string;
}

interface Output {
  readonly ok: boolean;
  readonly problems: readonly Problem[];
}

/** The requirements of fixtures/SR-093/junit (SR-46fb54, SR-0b0036, SR-0c0037). */
const LOGIN = "0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54";
const REPORT = "93000000-0000-4000-8000-0000000b0036";
const RESULTS = "evidence/ci/vitest.xml";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

/** `reqseq workspace check --json` on fixtures/SR-093/junit with `files` written on top. */
const check = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ code: number | null; output: Output }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-093/junit", files });
  fixtures.push(ws);
  const run = await reqseq(["workspace", "check", "--json"], { cwd: ws.root });
  return { code: run.code, output: JSON.parse(run.stdout) as Output };
};

const evidence = (output: Output): (string | number | undefined)[][] =>
  output.problems
    .filter((p) => p.code.startsWith("evidence."))
    .map((p) => [p.code, p.elementId, p.file, p.line, p.storedVersion]);

describe("reqseq reads JUnit XML as records (SR-093)", () => {
  it("[SR-093/AK1] reqseq workspace check reads an enriched JUnit file from the evidence folder and assigns each test case to its requirement", async () => {
    const { code, output } = await check();
    // SR-46fb54 and SR-0b0036 have records of older versions (the second test case names two
    // requirements, each with its own version); SR-0c0037 has one of its current version. The skipped
    // test case at line 34 names SR-46fb54 with its current version and gives no record, so it does
    // not hide the outdated one.
    expect(evidence(output)).toEqual([
      ["evidence.outdated", REPORT, RESULTS, 17, "n1:2222222222222222"],
      ["evidence.outdated", LOGIN, RESULTS, 4, "n1:1111111111111111"],
    ]);
    expect(code).toBe(0);
  });

  it("[SR-093/AK2] reqseq workspace check passes over test cases that name no requirement without a problem", async () => {
    // A pytest file whose test cases name no requirement (parameter lists, a skipped one). Workspace
    // check shows the problems of the read state (SR-028's evidenceProblemsState), so this proves
    // that no record arises and that the reader reports nothing.
    const pytest =
      '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" tests="3">' +
      '<testcase classname="test_sample" name="test_add[1-2]" time="0.001"/>' +
      '<testcase classname="test_sample" name="test_add[3-4]" time="0.000"><failure message="no"/></testcase>' +
      '<testcase classname="test_sample" name="test_skipped" time="0.000"><skipped/></testcase>' +
      "</testsuite></testsuites>";
    const { code, output } = await check({ "evidence/ci/pytest.xml": pytest });
    expect(output.problems.map((p) => p.code)).toEqual(["evidence.outdated", "evidence.outdated"]);
    expect(output.problems.every((p) => p.file === RESULTS)).toBe(true);
    expect(code).toBe(0);
  });
});
