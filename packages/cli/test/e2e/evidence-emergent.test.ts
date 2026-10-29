// `reqseq evidence status`, `reqseq element list` and `reqseq element get` end to end with emergent
// requirements (SR-035): the built binary on fixtures/SR-035/emergent, whose README lists every element,
// its mark, its parent and its Markdown record. Run after `pnpm build` with `pnpm test:e2e`.
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

const U = (tail: string): string => `35353535-3535-4535-8535-00000000${tail}`;

const reqseq = async (args: readonly string[]): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-035/emergent" });
  fixtures.push(ws);
  return run(args, { cwd: ws.root });
};

describe("reqseq with emergent requirements (SR-035)", () => {
  it("[SR-035/AK1] reqseq evidence status prints open for an emergent requirement whose children are verified, and its parent names it missing", async () => {
    const result = await reqseq(["evidence", "status"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      [
        "elements:",
        "  N-00a001  approved  Know the weather  [validation: open]",
        "  SR-00b100  approved  Show the weather  [verification: core open (missing SR-00b110)]",
        "  SR-00b110  approved  Show the forecast  [emergent]  [verification: core open]",
        "  SR-00b111  approved  Show the forecast for today  [verification: core verified]",
        "  SR-00b112  approved  Show the forecast for tomorrow  [verification: core verified]",
        "  SR-00b120  approved  Show the wind  [verification: core indirect]",
        "  SR-00b121  approved  Show wind speed  [verification: core verified]",
        "  SR-00b130  approved  Warn of storms  [emergent]  [verification: core verified]",
        "  SR-00b131  approved  Warn of gusts  [verification: core verified]",
        "  SR-00b140  approved  Warn of frost  [emergent]  [verification: core outdated]",
        "  SR-00b141  approved  Warn of ice on the road  [verification: core verified]",
        "  SR-00b150  approved  Keep the station running  [emergent]  [verification: core open]",
        "total: 12",
        "",
      ].join("\n"),
    );
  });

  it("[SR-035/AK2] reqseq element list with the condition emergent lists exactly the marked requirements, each with [emergent]", async () => {
    const input = JSON.stringify({ selection: { where: { emergent: true } } });
    const result = await reqseq(["element", "list", "--input", input]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      [
        "elements:",
        "  SR-00b110  approved  Show the forecast  [emergent]",
        "  SR-00b130  approved  Warn of storms  [emergent]",
        "  SR-00b140  approved  Warn of frost  [emergent]",
        "  SR-00b150  approved  Keep the station running  [emergent]",
        "total: 4",
        "",
      ].join("\n"),
    );
    const json = await reqseq(["element", "list", "--input", input, "--json"]);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const out = JSON.parse(json.stdout) as {
      readonly elements: readonly { readonly id: string; readonly emergent?: boolean }[];
    };
    expect(out.elements.map((e) => [e.id, e.emergent])).toEqual([
      [U("b110"), true],
      [U("b130"), true],
      [U("b140"), true],
      [U("b150"), true],
    ]);
  });

  it("[SR-035/AK2] reqseq element get --json shows emergent true", async () => {
    const result = await reqseq(["element", "get", "SR-00b110", "--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as {
      readonly element: {
        readonly emergent?: boolean;
        readonly properties: Readonly<Record<string, unknown>>;
        readonly verification?: unknown;
      };
    };
    expect([out.element.emergent, out.element.properties["emergent"], out.element.verification]).toEqual([
      true,
      "yes",
      [{ view: "core", status: "open" }],
    ]);
    const other = JSON.parse((await reqseq(["element", "get", "SR-00b120", "--json"])).stdout) as {
      readonly element: Readonly<Record<string, unknown>>;
    };
    expect("emergent" in other.element).toBe(false);
  });
});
