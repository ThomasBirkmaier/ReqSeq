// `logreq evidence degree` end to end (SR-037, ADR-0009): the built binary on fixtures/SR-037/degree (its
// README lists every element, its record, its status and its packages), with the records read from the
// Markdown files of the fixture, as readable output and as JSON. The selection is complex input, so it
// comes with `--input`. Run after `pnpm build` with `pnpm test:e2e`.
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

describe("logreq evidence degree (SR-037)", () => {
  it("[SR-037/AK1] logreq evidence degree prints 60 % and the count per status for a package", async () => {
    const result = await degree({ selection: { package: "PKG-00d001" } });
    expect([result.code, result.stderr, result.stdout]).toEqual([0, "", P1]);
  });

  it("[SR-037/AK2] logreq evidence degree --json counts indirect requirements as verified and apart", async () => {
    const result = await degree({ selection: { package: "PKG-00d002" } }, ["--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(JSON.parse(result.stdout)).toEqual({
      degree: { share: 0.6, total: 5, counts: { open: 1, verified: 2, indirect: 1, failed: 1, outdated: 0 } },
      view: "core",
      incomplete: false,
    });
  });

  it("[SR-037/AK3] logreq evidence degree leaves out the requirements with an obsolete status", async () => {
    const result = await degree({ selection: { package: "PKG-00d003" } });
    expect([result.code, result.stderr, result.stdout]).toEqual([0, "", P1]);
  });

  it("prints 64.2 % for the whole workspace: 9 of 14, rounded down", async () => {
    const result = await degree({});
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain("degree:\n  share: 64.2 %\n  total: 14\n");
  });
});
