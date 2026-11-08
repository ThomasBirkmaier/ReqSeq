// The verification status per variant end to end (SR-047): the built binary on fixtures/SR-043/example
// with an evidence location `evidence`, where variant A „Coast“ (VAR-0000c1) replaces K1 (SR-0000a1) by
// A1 (SR-0000b1) and excludes K2 (SR-0000a2); B „Mountain“ (VAR-0000c2) and C „Desert“ (VAR-0000c3)
// change nothing. The spec's „C excludes“ is A here. Records are written with `reqseq evidence record`.
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const WORKSPACE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n";

const open = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    fixture: "SR-043/example",
    files: { "reqseq-workspace.yaml": WORKSPACE, "evidence/.keep": "" },
    git: true,
  });
  fixtures.push(ws);
  return ws;
};

/** `reqseq evidence record <ref> verification <result> --method test`, for `variant` when given. */
const record = (ws: FixtureWorkspace, ref: string, result: string, variant?: string) =>
  reqseq(
    [
      "evidence",
      "record",
      ref,
      "verification",
      result,
      "--method",
      "test",
      "--item",
      "build-47",
      "--date",
      "2026-11-01T10:00:00Z",
      ...(variant === undefined ? [] : ["--variant", variant]),
    ],
    { cwd: ws.root },
  );

/** Records `ref` with `result` (for `variant`), which must be written. */
const recorded = async (
  ws: FixtureWorkspace,
  ref: string,
  result: string,
  variant?: string,
): Promise<void> => {
  const run = await record(ws, ref, result, variant);
  expect([run.code, run.stderr]).toEqual([0, ""]);
};

/** The line `reqseq evidence status` prints for `ref`. */
const statusLine = async (ws: FixtureWorkspace, ref: string): Promise<string | undefined> => {
  const run = await reqseq(["evidence", "status"], { cwd: ws.root });
  expect([run.code, run.stderr]).toEqual([0, ""]);
  return run.stdout.split("\n").find((line) => line.trim().startsWith(`${ref} `));
};

describe("reqseq evidence status and record per variant (SR-047)", () => {
  it("[SR-047/AK1] a passed record for A leaves the status in B open", async () => {
    const ws = await open();
    await recorded(ws, "SR-0000a3", "passed", "VAR-0000c1");
    expect(await statusLine(ws, "SR-0000a3")).toBe(
      "  SR-0000a3  draft  Measure the rain  [verification: core open, VAR-0000c1 verified, VAR-0000c2 open, VAR-0000c3 open]",
    );
  });

  it("[SR-047/AK2] a record without variant counts only for the core", async () => {
    const ws = await open();
    await recorded(ws, "SR-0000a4", "passed");
    expect(await statusLine(ws, "SR-0000a4")).toBe(
      "  SR-0000a4  draft  Show the temperature  [verification: core verified, VAR-0000c1 open, VAR-0000c2 open, VAR-0000c3 open]",
    );
  });

  it("[SR-047/AK3] the status shows one row for the core and each variant it is in, none for excluding or replacing variants", async () => {
    const ws = await open();
    await recorded(ws, "SR-0000a2", "passed");
    await recorded(ws, "SR-0000a2", "failed", "VAR-0000c2");
    await recorded(ws, "SR-0000b1", "failed", "VAR-0000c1");
    expect([
      await statusLine(ws, "SR-0000a2"),
      await statusLine(ws, "SR-0000a1"),
      await statusLine(ws, "SR-0000b1"),
    ]).toEqual([
      "  SR-0000a2  draft  Measure the wind  [verification: core verified, VAR-0000c2 failed, VAR-0000c3 open]",
      "  SR-0000a1  draft  Response time at most 10 ms  [verification: core open, VAR-0000c2 open, VAR-0000c3 open]",
      "  SR-0000b1  draft  Response time at most 20 ms  [verification: VAR-0000c1 failed]",
    ]);
  });

  it("[SR-047/AK4] evidence.record for C refuses a core requirement excluded or replaced in C, naming the exclusion or the replacement", async () => {
    const ws = await open();
    const excluded = await record(ws, "SR-0000a2", "passed", "VAR-0000c1");
    const replaced = await record(ws, "SR-0000a1", "passed", "VAR-0000c1");
    expect([excluded.code, excluded.stdout, excluded.stderr]).toEqual([
      2,
      "",
      "error input.invalid: SR-0000a2 is excluded in VAR-0000c1, so a record for it there would count nowhere (SR-047)\n",
    ]);
    expect([replaced.code, replaced.stdout, replaced.stderr]).toEqual([
      2,
      "",
      "error input.invalid: SR-0000a1 is replaced in VAR-0000c1 by SR-0000b1, so a record for it there would count nowhere; record SR-0000b1 instead (SR-047)\n",
    ]);
    expect(await fs.readdir(ws.path("evidence"))).toEqual([".keep"]);
  });
});

describe("reqseq evidence status in a variant-independent repository (SR-173)", () => {
  it("[SR-047/AK2] [SR-173/AK1] a record without variant counts for the core and every variant the requirement applies in", async () => {
    const ws = await open();
    await ws.write(
      "reqseq-workspace.yaml",
      WORKSPACE.replace("main: true }", "main: true, variant-independent: true }"),
    );
    await recorded(ws, "SR-0000a4", "passed");
    await recorded(ws, "SR-0000a2", "passed");
    expect([await statusLine(ws, "SR-0000a4"), await statusLine(ws, "SR-0000a2")]).toEqual([
      "  SR-0000a4  draft  Show the temperature  [verification: core verified, VAR-0000c1 verified, VAR-0000c2 verified, VAR-0000c3 verified]",
      // Excluded in A: no row there (SR-047 AK3).
      "  SR-0000a2  draft  Measure the wind  [verification: core verified, VAR-0000c2 verified, VAR-0000c3 verified]",
    ]);
  });
});

describe("reqseq element create and update name the views by short ID (#1216)", () => {
  it("prints the same verification line as reqseq element get", async () => {
    const ws = await open();
    const line = async (args: string[]): Promise<string | undefined> => {
      const run = await reqseq(args, { cwd: ws.root });
      expect([run.code, run.stderr]).toEqual([0, ""]);
      return run.stdout.split("\n")[0];
    };
    const shown = await reqseq(["element", "get", "SR-0000a3", "--json"], { cwd: ws.root });
    const { fileSha256 } = JSON.parse(shown.stdout) as { fileSha256: string };
    const updated = await line([
      "element",
      "update",
      "SR-0000a3",
      "--title",
      "Measure the rain",
      "--expected-file-sha256",
      fileSha256,
    ]);
    expect(updated).toBe(
      "SR-0000a3  draft  Measure the rain  [verification: core open, VAR-0000c1 open, VAR-0000c2 open, VAR-0000c3 open]",
    );
    expect(await line(["element", "get", "SR-0000a3"])).toBe(updated);
    const created = await line(["element", "create", "system-requirement", "Show the wind speed"]);
    expect(created).toMatch(
      /^SR-\w+ {2}draft {2}Show the wind speed {2}\[verification: core open, VAR-0000c1 open, VAR-0000c2 open, VAR-0000c3 open\]$/,
    );
  });
});
