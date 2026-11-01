// `reqseq evidence enrich-junit` end to end (SR-029, ADR-0009): the built binary on fixtures/SR-029/enrich
// (see its README), from the root of the workspace, with relative paths (the CLI makes them absolute
// from its current folder). Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

const LOGIN = "0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54";
const SPEC = "29000000-0000-4000-8000-0000000d0038";
const DATE = "2026-10-27T10:00:00Z";

interface Problem {
  readonly code: string;
  readonly severity: string;
  readonly file?: string;
  readonly line?: number;
}

interface Output {
  readonly testCases: number;
  readonly unknown: readonly { readonly testCase: string; readonly line: number; readonly ref: string }[];
  readonly files: readonly string[];
  readonly problems: readonly Problem[];
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const open = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-029/enrich" });
  fixtures.push(ws);
  return ws;
};

/** `reqseq evidence enrich-junit <file> <item> …` in the root of `ws`. */
const enrich = (ws: FixtureWorkspace, args: readonly string[]): Promise<Run> =>
  reqseq(["evidence", "enrich-junit", ...args], { cwd: ws.root });

const decode = (s: string): string =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/**
 * The `reqseq:*` properties of each test case of a JUnit file, read with a small regex (the JUnit model
 * is no public export of `@reqseq/core`): enough for the files enrich writes.
 */
const properties = (xml: string): Record<string, Record<string, string[]>> => {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [, attributes = "", body = ""] of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const name = decode(/\bname="([^"]*)"/.exec(attributes)?.[1] ?? "");
    const found: Record<string, string[]> = {};
    for (const [, key = "", value = ""] of body.matchAll(
      /<property name="(reqseq:[a-z]+)" value="([^"]*)"/g,
    )) {
      (found[key] ??= []).push(decode(value));
    }
    out[name] = found;
  }
  return out;
};

describe("reqseq evidence enrich-junit (SR-029)", () => {
  it("[SR-029/AK1] reqseq evidence enrich-junit writes UUID, version, item and date into each test case of a pytest file", async () => {
    const ws = await open();
    const run = await enrich(ws, ["results/pytest.xml", "build-512", "--date", DATE, "--json"]);
    expect([run.code, run.stderr]).toEqual([0, ""]);
    expect(JSON.parse(run.stdout)).toEqual({
      testCases: 3,
      unknown: [],
      files: ["results/pytest.xml"],
      problems: [],
    });
    const props = properties(await fs.readFile(ws.path("results/pytest.xml"), "utf8"));
    const enriched = Object.entries(props).filter(([, p]) =>
      ["reqseq:element", "reqseq:version", "reqseq:item", "reqseq:date"].every(
        (key) => (p[key]?.length ?? 0) > 0,
      ),
    );
    // Exactly the test cases that name a requirement, each with all four.
    expect(enriched.map(([name]) => name)).toEqual([
      "test_login_by_property",
      "test_named[SR-46fb54]",
      "test_named[SR-036]",
    ]);
    for (const [, p] of enriched) {
      expect(p["reqseq:version"]?.[0]).toMatch(/^n1:[0-9a-f]{16}$/);
      expect([p["reqseq:item"], p["reqseq:date"]]).toEqual([["build-512"], [DATE]]);
    }
    expect(enriched.map(([, p]) => p["reqseq:element"])).toEqual([[LOGIN], [LOGIN], [SPEC]]);
    expect(props["test_add[1-2]"]).toEqual({});
  });

  it("[SR-029/AK2] reqseq evidence enrich-junit names the test case with an unknown short ID and exits with code 1", async () => {
    const ws = await open();
    const json = await enrich(ws, ["results/unknown.xml", "build-512", "--date", DATE, "--json"]);
    expect(json.code).toBe(1);
    const out = JSON.parse(json.stdout) as Output;
    expect(out.unknown.map((u) => [u.testCase, u.line, u.ref])).toEqual([
      ["[SR-ffffff] names no element", 4, "SR-ffffff"],
      ["a typo in the property", 5, "SR-0366"],
    ]);
    expect(out.problems.map((p) => [p.code, p.severity, p.file, p.line])).toEqual([
      ["evidence.unknown-element", "error", "results/unknown.xml", 4],
      ["evidence.unknown-element", "error", "results/unknown.xml", 5],
    ]);
    // Readable output names the test case too, and the exit code is the same.
    const other = await open();
    const readable = await enrich(other, ["results/unknown.xml", "build-512", "--date", DATE]);
    expect(readable.code).toBe(1);
    expect(readable.stdout + readable.stderr).toContain("[SR-ffffff] names no element");
  });

  it("[SR-029/AK3] reqseq workspace check and evidence coverage read the enriched file without further input", async () => {
    const ws = await open();
    const coverage = async (): Promise<readonly string[] | undefined> => {
      const run = await reqseq(["evidence", "coverage", "--json"], { cwd: ws.root });
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as {
        levels: readonly { type: string; elements: Readonly<Record<string, readonly string[]>> }[];
      };
      return out.levels.find((l) => l.type === "system-requirement")?.elements["withEvidence"];
    };
    expect(await coverage()).toEqual([]);
    const run = await enrich(ws, ["results/vitest.xml", "build-512", "--output", "evidence/ci/vitest.xml"]);
    expect(run.code).toBe(0);
    const check = await reqseq(["workspace", "check", "--json"], { cwd: ws.root });
    const problems = (JSON.parse(check.stdout) as { problems: readonly Problem[] }).problems;
    expect(problems.filter((p) => p.code.startsWith("evidence."))).toEqual([]);
    expect([...((await coverage()) ?? [])].sort()).toEqual([LOGIN, SPEC].sort());
  });

  it("prints the written file and the number of test cases as readable output", async () => {
    const ws = await open();
    const run = await enrich(ws, ["results/two.xml", "build-512", "--date", DATE]);
    expect([run.code, run.stderr]).toEqual([0, ""]);
    expect(run.stdout).toContain("results/two.xml");
    expect(run.stdout).toMatch(/testCases:\s*3/);
  });

  it("writes --output after an in-place enrich, when the input has nothing left to change", async () => {
    const ws = await open();
    expect((await enrich(ws, ["results/vitest.xml", "build-512", "--date", DATE])).code).toBe(0);
    const enriched = await fs.readFile(ws.path("results/vitest.xml"));
    const run = await enrich(ws, [
      "results/vitest.xml",
      "build-512",
      "--output",
      "evidence/ci/vitest.xml",
      "--json",
    ]);
    expect([run.code, run.stderr]).toEqual([0, ""]);
    expect((JSON.parse(run.stdout) as Output).files).toEqual(["evidence/ci/vitest.xml"]);
    expect(await fs.readFile(ws.path("evidence/ci/vitest.xml"))).toEqual(enriched);
  });

  it("writes to an --output outside the workspace and leaves the input unchanged", async () => {
    const ws = await open();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-enrich-e2e-")));
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    const target = path.join(outside, "pytest.xml");
    const before = await fs.readFile(ws.path("results/pytest.xml"));
    const run = await enrich(ws, [
      "results/pytest.xml",
      "build-512",
      "--date",
      DATE,
      "--output",
      target,
      "--json",
    ]);
    expect([run.code, run.stderr]).toEqual([0, ""]);
    expect((JSON.parse(run.stdout) as Output).files).toEqual([target]);
    expect(
      Object.values(properties(await fs.readFile(target, "utf8"))).filter((p) => p["reqseq:version"]),
    ).toHaveLength(3);
    expect(await fs.readFile(ws.path("results/pytest.xml"))).toEqual(before);
  });

  it("[SR-029/AK8] [SR-029/AK9] reqseq evidence enrich-junit names a test case whose variant does not fit and exits with code 1", async () => {
    const ws = await createFixtureWorkspace({
      fixture: "SR-043/example",
      files: {
        "results/run.xml":
          '<testsuites><testsuite name="s"><testcase name="[SR-0000a3] rain">' +
          '<properties><property name="reqseq:variant" value="VAR-0000c2"/></properties></testcase>' +
          '<testcase name="[SR-0000a2] wind"/></testsuite></testsuites>',
      },
    });
    fixtures.push(ws);
    const run = await enrich(ws, ["results/run.xml", "build-631", "--date", DATE, "--variant", "VAR-0000c1"]);
    expect(run.code).toBe(1);
    expect(run.stdout + run.stderr).toContain(
      'reqseq:variant "VAR-0000c2" names another variant than the given one, VAR-0000c1',
    );
    expect(run.stdout + run.stderr).toContain("SR-0000a2 is excluded in VAR-0000c1");
  });
});
