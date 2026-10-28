// `logreq evidence without-passed-test` end to end (SR-120, ADR-0009): the built binary on
// fixtures/SR-126/matrix (its README lists every element, its records and its status), with the records
// read from the JUnit and Markdown files of the fixture, as readable output and as JSON. It needs no
// argument. Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const withoutPassedTest = async (
  args: readonly string[] = [],
  files: Readonly<Record<string, string>> = {},
): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-126/matrix", files });
  fixtures.push(ws);
  return run(["evidence", "without-passed-test", ...args], { cwd: ws.root });
};

/** A failed run of SR-126b08 after its passed one: its parent b07 is then open, missing b08. */
const B08_FAILED = [
  "---",
  "logreq-record: 1",
  "kind: verification",
  "element: 5c0e1d2a-0126-4126-8126-000000126b08",
  "version: n1:2354041ae88fca1d",
  "method: test",
  "item: build-700",
  "result: failed",
  "date: 2026-10-29T10:00:00Z",
  "---",
  "",
].join("\n");

const U = (tail: string): string => `5c0e1d2a-0126-4126-8126-000000126${tail}`;

describe("logreq evidence without-passed-test (SR-120)", () => {
  it("prints the requirements without passed test, without arguments", async () => {
    const result = await withoutPassedTest();
    expect([result.code, result.stderr, result.stdout]).toEqual([
      0,
      "",
      [
        "elements:",
        "  SR-126b02  draft  Log wind speed  [verification: core failed]",
        "  SR-126b04  draft  Show gusts  [verification: core open]",
        "  SR-126b05  draft  Show the wind on the display  [verification: core verified]",
        "  SR-126b06  draft  Warn of strong wind  [verification: core open]",
        "  SR-126b07  draft  Show the wind direction  [verification: core indirect]",
        "total: 5",
        "view: core",
        "",
      ].join("\n"),
    ]);
  });

  it("[SR-120/AK2] logreq evidence without-passed-test --json leaves out every requirement with a passed test execution", async () => {
    const result = await withoutPassedTest(["--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as { elements: { id: string }[]; total: number; view: string };
    expect([out.elements.map((e) => e.id), out.total, out.view]).toEqual([
      ["b02", "b04", "b05", "b06", "b07"].map(U),
      5,
      "core",
    ]);
  });

  it("names a missing child by its short ID", async () => {
    const result = await withoutPassedTest([], { "evidence/2026-10-29-SR-126b08-test.md": B08_FAILED });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(
      "  SR-126b07  draft  Show the wind direction  [verification: core open (missing SR-126b08)]\n",
    );
  });
});
