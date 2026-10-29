// `reqseq trace graph` end to end (SR-111): the built binary on fixtures/SR-111/graph, as JSON and as
// lines. SR-b0000000001 derives from a need, is based on a decision, is in a package, supersedes an
// obsolete requirement and references a decision with an outdated version; three component
// requirements derive from it, one with an outdated version, and two levels more hang below the first.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

interface Output {
  readonly root: string;
  readonly nodes: readonly {
    readonly shortId: string;
    readonly level: number;
    readonly expanded: boolean;
    readonly marks: readonly string[];
  }[];
  readonly edges: readonly { readonly kind?: string; readonly outdated: boolean }[];
  readonly truncated: boolean;
  readonly incomplete: boolean;
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const graph = async (args: readonly string[]): Promise<{ run: Run; output: Output }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-111/graph" });
  fixtures.push(ws);
  const result = await run(["trace", "graph", ...args, "--json"], { cwd: ws.root });
  return { run: result, output: JSON.parse(result.stdout) as Output };
};

const nodes = (output: Output): unknown[] => output.nodes.map((n) => [n.shortId, n.level]);

describe("reqseq trace graph (SR-111)", () => {
  it("[SR-111/AK1] gives the element at level 0, its parents above and its children below", async () => {
    const { run: result, output } = await graph(["SR-b0000000001", "--meanings", "derivation"]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(nodes(output)).toEqual([
      ["SR-b0000000001", 0],
      ["N-a0000000001", -1],
      ["CR-c0000000001", 1],
      ["CR-c0000000002", 1],
      ["CR-c0000000003", 1],
    ]);
    expect([output.truncated, output.incomplete]).toEqual([false, false]);
  });

  it("[SR-111/AK2] gives a chosen number of levels, the whole chain, and at most --limit nodes", async () => {
    const two = await graph(["SR-b0000000001", "--meanings", "derivation", "--max-depth", "2"]);
    expect(nodes(two.output).at(-1)).toEqual(["CR-000004", 2]);
    const all = await graph(["SR-b0000000001", "--meanings", "derivation", "--all-levels"]);
    expect(nodes(all.output).at(-1)).toEqual(["CR-000005", 3]);
    const cut = await graph(["SR-b0000000001", "--all-levels", "--limit", "3"]);
    expect([cut.output.nodes.length, cut.output.truncated]).toEqual([3, true]);
  });

  it("[SR-111/AK3] follows only the chosen relation kinds", async () => {
    const { output } = await graph(["SR-b0000000001", "--kinds", "based-on"]);
    expect(nodes(output)).toEqual([
      ["SR-b0000000001", 0],
      ["D-d0000000001", -1],
    ]);
    expect(output.edges.map((e) => e.kind)).toEqual(["based-on"]);
  });

  it("[SR-111/AK4] marks a node only when it is outdated, superseded or without evidence", async () => {
    const { output } = await graph(["SR-b0000000001"]);
    expect(output.nodes.filter((n) => n.marks.length > 0).map((n) => [n.shortId, n.marks])).toEqual([
      ["SR-b0000000001", ["outdated"]],
      ["SR-b0000000002", ["superseded", "no-evidence"]],
      ["CR-c0000000002", ["outdated", "no-evidence"]],
      ["CR-c0000000003", ["no-evidence"]],
    ]);
  });

  it("shows the nodes as lines without --json, and ends with exit code 2 for both depths", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-111/graph" });
    fixtures.push(ws);
    const human = await run(["trace", "graph", "SR-b0000000001", "--max-depth", "0"], { cwd: ws.root });
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("SR-b0000000001  draft  Show wind speed");
    const failed = await run(
      ["trace", "graph", "SR-b0000000001", "--max-depth", "1", "--all-levels", "--json"],
      {
        cwd: ws.root,
      },
    );
    expect([failed.code, failed.stdout]).toEqual([2, ""]);
    expect(JSON.parse(failed.stderr)).toMatchObject({ code: "input.invalid" });
  });
});
