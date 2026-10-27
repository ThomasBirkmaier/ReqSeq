// `logreq evidence status` and `logreq element get` end to end with the indirect verification
// (SR-034): the built binary on fixtures/SR-034/indirect, whose README lists every element, its
// parent and its Markdown record. Run after `pnpm build` with `pnpm test:e2e`.
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

const U = (tail: string): string => `34343434-3434-4434-8434-00000000${tail}`;

const logreq = async (args: readonly string[]): Promise<Run> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-034/indirect" });
  fixtures.push(ws);
  return run(args, { cwd: ws.root });
};

describe("logreq evidence status and element get with indirect verification (SR-034)", () => {
  it("[SR-034/AK1] logreq evidence status prints indirect for a parent whose children are verified by record files", async () => {
    const result = await logreq(["evidence", "status"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      [
        "elements:",
        "  N-00a001  approved  Know the weather",
        "  SR-00b100  approved  Show the weather  [verification: core indirect]",
        "  SR-00b110  approved  Show the wind  [verification: core indirect]",
        "  SR-00b111  approved  Show wind speed  [verification: core verified]",
        "  SR-00b112  draft  Show wind direction  [verification: core verified]",
        "  SR-00b120  approved  Warn of storms  [verification: core open (missing SR-00b121, SR-00b122, SR-00b123)]",
        "  SR-00b121  draft  Warn of gusts  [verification: core failed]",
        "  SR-00b122  draft  Warn of hail  [verification: core open]",
        "  SR-00b123  draft  Warn of lightning  [verification: core outdated]",
        "  SR-00b124  draft  Warn of frost  [verification: core verified]",
        "  SR-00b130  approved  Show the rain  [verification: core indirect]",
        "  SR-00b131  draft  Show rain per hour  [verification: core verified]",
        "  SR-00b132  obsolete  Show rain per minute  [verification: core open]",
        "  SR-00b141  draft  Show the temperature  [verification: core verified]",
        "  SR-00b150  approved  Show the pressure  [verification: core outdated]",
        "  SR-00b151  draft  Show pressure in hPa  [verification: core verified]",
        "  SR-00b160  approved  Show the humidity  [verification: core open]",
        "  SR-00b161  obsolete  Show dew point  [verification: core open]",
        "  UC-00e161  approved  Check the humidity",
        "total: 19",
        "",
      ].join("\n"),
    );
  });

  it("[SR-034/AK2] logreq evidence status --json names the children that are missing", async () => {
    const input = JSON.stringify({ selection: { ids: [U("b120"), U("b150"), U("b160")] } });
    const result = await logreq(["evidence", "status", "--input", input, "--json"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const out = JSON.parse(result.stdout) as {
      readonly elements: readonly { readonly shortId: string; readonly verification?: unknown }[];
    };
    expect(out.elements.map((e) => [e.shortId, e.verification])).toEqual([
      ["SR-00b120", [{ view: "core", status: "open", missingChildren: [U("b121"), U("b122"), U("b123")] }]],
      ["SR-00b150", [{ view: "core", status: "outdated" }]],
      ["SR-00b160", [{ view: "core", status: "open" }]],
    ]);
  });

  it("[SR-034/AK3] logreq element get shows a parent with an obsolete child as indirect", async () => {
    const result = await logreq(["element", "get", "SR-00b130"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout.split("\n")[0]).toBe(
      "SR-00b130  approved  Show the rain  [verification: core indirect]",
    );
    const json = await logreq(["element", "get", "SR-00b130", "--json"]);
    const out = JSON.parse(json.stdout) as {
      readonly element: { readonly status: string; readonly verification: unknown };
    };
    // The element's own status is shown as written, never the computed one (D-030).
    expect([out.element.status, out.element.verification]).toEqual([
      "approved",
      [{ view: "core", status: "indirect" }],
    ]);
  });
});
