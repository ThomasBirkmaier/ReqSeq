// `reqseq evidence coverage` end to end (SR-036, ADR-0009): the built binary on fixtures/SR-036/levels
// (see packages/core/src/commands/evidence/coverage.test.ts for its elements), as JSON and as readable
// output; without a view only the core counts (AK5). The selection is complex input, so it comes with
// `--input`. Evidence records are read from files once the readers are in (SR-028, SR-093); their
// end-to-end tests add the counts with records.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

interface Output {
  readonly levels: readonly {
    readonly type: string;
    readonly total: number;
    readonly withChildren: number;
    readonly withEvidence?: number;
    readonly elements: Readonly<Record<string, readonly string[]>>;
  }[];
  readonly incomplete: boolean;
  readonly names?: readonly { readonly id: string; readonly shortId: string; readonly title: string }[];
}

const P = "36036036-0000-4000-8000-0000000000";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const coverage = async (input: unknown, args: readonly string[] = ["--json"]): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-036/levels" });
  fixtures.push(ws);
  return run(["evidence", "coverage", "--input", JSON.stringify(input), ...args], { cwd: ws.path("system") });
};

describe("reqseq evidence coverage (SR-036)", () => {
  it("[SR-036/AK1] reqseq evidence coverage prints the counts per type for a saved filter", async () => {
    const result = await coverage({ selection: { filter: "Requirements" } });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as Output;
    expect(out.incomplete).toBe(false);
    expect(out.levels.map((l) => [l.type, l.total, l.withChildren, l.withEvidence])).toEqual([
      ["system-requirement", 2, 1, 0],
    ]);
  });

  it("[SR-036/AK2] reqseq evidence coverage lists the requirements behind each number, as readable output too", async () => {
    const result = await coverage({ selection: { where: { type: ["need"] } } }, []);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    // By short ID and title, as other listings (#588); `--json` keeps the UUIDs.
    expect(result.stdout).toContain(
      "withChildren:\n        - N-0000a1  See the wind\n      withoutChildren:\n        - N-0000a2  Warn of storms\n",
    );
    expect(result.stdout).not.toContain(P);
    expect(result.stdout).not.toContain("names:");
  });

  it("[SR-036/AK2] reqseq evidence coverage --json keeps the UUIDs and names them in names (#588)", async () => {
    const result = await coverage({ selection: { where: { type: ["need"] } } });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as Output;
    expect(out.levels.map((l) => l.elements)).toEqual([
      { withChildren: [`${P}a1`], withoutChildren: [`${P}a2`] },
    ]);
    expect(out.names?.map((n) => [n.id, n.shortId, n.title])).toEqual([
      [`${P}a1`, "N-0000a1", "See the wind"],
      [`${P}a2`, "N-0000a2", "Warn of storms"],
    ]);
  });
});
