// variant exclude end to end (SR-042): the built binary on fixtures/SR-043/example, where variant A
// (VAR-0000c1) replaces K1 (SR-0000a1) by A1 (SR-0000b1), excludes K2 (SR-0000a2) and adds A2
// (SR-0000b2). Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const A_FILE = "variants/VAR-0000000000c1.md";

const workspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-043/example" });
  fixtures.push(ws);
  return ws;
};

const read = (ws: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(path.join(ws.root, file), "utf8");

/** The short IDs of the system requirements in `view`. */
const requirementsIn = async (ws: FixtureWorkspace, view: string): Promise<string[]> => {
  const input = { selection: { view, where: { type: ["system-requirement"] } } };
  const result = await run(["element", "list", "--input", JSON.stringify(input), "--json"], { cwd: ws.root });
  expect([result.code, result.stderr]).toEqual([0, ""]);
  return (JSON.parse(result.stdout) as { elements: { shortId: string }[] }).elements.map((e) => e.shortId);
};

describe("variant exclude (SR-042)", () => {
  it("[SR-042/AK1] variant exclude removes K3 from the view of A only", async () => {
    const ws = await workspace();
    const result = await run(["variant", "exclude", "VAR-0000c1", "--refs", "SR-0000a3"], { cwd: ws.root });
    expect([result.code, result.stdout, result.stderr]).toEqual([
      0,
      `files:\n  ${A_FILE}\nNo problems.\n`,
      "",
    ]);
    expect(await requirementsIn(ws, "VAR-0000c1")).toEqual(["SR-0000a4", "SR-0000b1", "SR-0000b2"]);
    expect(await requirementsIn(ws, "VAR-0000c2")).toEqual([
      "SR-0000a1",
      "SR-0000a2",
      "SR-0000a3",
      "SR-0000a4",
    ]);
  });

  it("[SR-042/AK2] the exclusion is written into the variant file and K3's file is unchanged", async () => {
    const ws = await workspace();
    const core = await read(ws, "requirements/SR-0000000000a3.md");
    const result = await run(["variant", "exclude", "VAR-0000c1", "--refs", "SR-0000a3", "--json"], {
      cwd: ws.root,
    });
    expect(JSON.parse(result.stdout)).toEqual({ files: [A_FILE], problems: [] });
    expect(await read(ws, "requirements/SR-0000000000a3.md")).toBe(core);
    expect(await read(ws, A_FILE)).toContain(
      "  - { id: 43043043-0000-4000-8000-0000000000a3, version: n1:67ebd0624004c969, title: Measure the rain }\n",
    );
  });

  it("[SR-042/AK3] coverage and degree in A do not count the excluded K2 and K3", async () => {
    const ws = await workspace();
    await run(["variant", "exclude", "VAR-0000c1", "--refs", "SR-0000a3"], { cwd: ws.root });
    const input = JSON.stringify({ selection: { view: "VAR-0000c1" } });
    const coverage = JSON.parse(
      (await run(["evidence", "coverage", "--input", input, "--json"], { cwd: ws.root })).stdout,
    ) as { levels: { type: string; total: number }[] };
    const degree = JSON.parse(
      (await run(["evidence", "degree", "--input", input, "--json"], { cwd: ws.root })).stdout,
    ) as {
      degree: { total: number };
    };
    expect([
      coverage.levels.find((l) => l.type === "system-requirement")?.total,
      degree.degree.total,
    ]).toEqual([3, 3]);
  });

  it("[SR-042/AK4] variant exclude refuses a requirement with validity: only core requirements", async () => {
    const ws = await workspace();
    const before = await read(ws, A_FILE);
    const result = await run(["variant", "exclude", "VAR-0000c1", "--refs", "SR-0000b2"], { cwd: ws.root });
    expect([result.code, result.stdout]).toEqual([2, ""]);
    expect(result.stderr).toContain("error input.invalid: Only core requirements can be excluded;");
    expect(await read(ws, A_FILE)).toBe(before);
  });

  it("[SR-042/AK6] variant exclude with undo removes the entry and K2 is back in A", async () => {
    const ws = await workspace();
    const result = await run(["variant", "exclude", "VAR-0000c1", "--refs", "SR-0000a2", "--undo"], {
      cwd: ws.root,
    });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(await read(ws, A_FILE)).not.toContain("excludes");
    expect(await requirementsIn(ws, "VAR-0000c1")).toContain("SR-0000a2");
  });
});
