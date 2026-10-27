// `logreq evidence coverage` end to end (SR-036, ADR-0009): the built binary on fixtures/SR-036/levels
// (see packages/core/src/commands/evidence/coverage.test.ts for its elements), as JSON and as readable
// output. The selection is complex input, so it comes with `--input`. Evidence records are read from
// files once the readers are in (SR-028, SR-093); their end-to-end tests add the counts with records.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

interface Output {
  readonly levels: readonly {
    readonly type: string;
    readonly total: number;
    readonly withChildren: number;
    readonly withEvidence?: number;
    readonly elements: Readonly<Record<string, readonly string[]>>;
  }[];
  readonly incomplete: boolean;
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

describe("logreq evidence coverage (SR-036)", () => {
  it("[SR-036/AK1] logreq evidence coverage prints the counts per type for a saved filter", async () => {
    const result = await coverage({ selection: { filter: "Requirements" } });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as Output;
    expect(out.incomplete).toBe(false);
    expect(out.levels.map((l) => [l.type, l.total, l.withChildren, l.withEvidence])).toEqual([
      ["system-requirement", 3, 3, 0],
    ]);
  });

  it("[SR-036/AK2] logreq evidence coverage lists the requirements behind each number, as readable output too", async () => {
    const result = await coverage({ selection: { where: { type: ["need"] } } }, []);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(
      `withChildren:\n        - ${P}a1\n      withoutChildren:\n        - ${P}a2\n`,
    );
  });
});
