// `logreq evidence status` end to end (SR-031): the built binary on fixtures/SR-031/status (the need
// N1, the requirements b1 and b3 in the core and both variants, b2 valid for the variant Pro only, the
// variants Pro and Basic), as lines and as JSON. The fixture has no record files: the readers come
// with SR-028 and SR-093, which add the end-to-end tests with records. Run after `pnpm build` with
// `pnpm test:e2e`.
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

const status = async (args: readonly string[]): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-031/status" });
  fixtures.push(ws);
  return run(["evidence", "status", ...args], { cwd: ws.root });
};

describe("logreq evidence status (SR-031)", () => {
  it("[SR-031/AK1] logreq evidence status prints open for every requirement without records, apart from its own status", async () => {
    const result = await status([]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      [
        "elements:",
        "  N-a0000000001  approved  See the wind",
        "  SR-b0000000001  draft  Show wind speed  [verification: core open, VAR-c0000000001 open, VAR-c0000000002 open]",
        "  SR-b0000000002  draft  Show gusts  [verification: VAR-c0000000001 open]",
        "  SR-000003  approved  Show wind direction  [verification: core open, VAR-c0000000001 open, VAR-c0000000002 open]",
        "  VAR-c0000000001  draft  Pro",
        "  VAR-c0000000002  draft  Basic",
        "total: 6",
        "",
      ].join("\n"),
    );
  });

  it("[SR-031/AK1] logreq evidence status --json gives the status per view of one page", async () => {
    const result = await status(["--limit", "1", "--offset", "2", "--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as {
      readonly elements: readonly { readonly shortId: string; readonly verification?: unknown }[];
      readonly total: number;
    };
    expect(out.elements.map((e) => [e.shortId, e.verification])).toEqual([
      ["SR-b0000000002", [{ view: "5e031a7d-2b4f-4c61-9d08-0c0000000001", status: "open" }]],
    ]);
    expect(out.total).toBe(6);
  });
});
