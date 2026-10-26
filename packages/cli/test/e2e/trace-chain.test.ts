// `logreq trace chain` end to end (SR-022, ADR-0009): the built binary with the product commands on
// fixture workspaces, its exit code, its JSON and its readable output. Also the tests SR-013 handed
// over to this command (#25: AK1 and AK3, #127 option 1). The evidence in the chain (SR-022 AK1, AK3;
// SR-033) comes with the evidence records of stage 4, and its CLI tests with it.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const logreq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

interface Output {
  readonly root: string;
  readonly nodes: readonly {
    readonly shortId: string;
    readonly depth: number;
    readonly direction?: string;
  }[];
  readonly edges: readonly { readonly kind: string; readonly cyclic: boolean }[];
  readonly gaps: readonly { readonly id: string; readonly kind: string }[];
  readonly incomplete: boolean;
  readonly problems: readonly { readonly code: string; readonly severity: string }[];
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const fixture = async (options: FixtureOptions): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace(options);
  fixtures.push(ws);
  return ws;
};

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const P = "5c0e1d2a-0022-4022-8022-00000000";
const V = "n1:0000000000000000";

describe("logreq trace chain (SR-022)", () => {
  it("[SR-022/AK1] prints every level below a need with its depth, as JSON and readable", async () => {
    const ws = await fixture({ fixture: "SR-022/chain" });
    const json = await logreq(["trace", "chain", "N-00a001", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const output = JSON.parse(json.stdout) as Output;
    expect(output.nodes.map((n) => [n.shortId, n.depth, n.direction])).toEqual([
      ["N-00a001", 0, undefined],
      ["SR-00b001", 1, "down"],
      ["SR-00b002", 1, "down"],
      ["CR-00c001", 2, "down"],
      ["CR-00c002", 2, "down"],
    ]);
    // Readable: an indented tree with the depth in front and the gaps marked (#310).
    const human = await logreq(["trace", "chain", "N-00a001"], ws.root);
    expect(human).toEqual({
      code: 0,
      stdout: [
        "N-00a001  approved  See the wind",
        "children:",
        "  1  SR-00b001  draft  Show wind speed",
        "  2    CR-00c001  draft  Count anemometer turns  [gap: no evidence]",
        "  2    CR-00c002  draft  Report a stalled anemometer  [gap: no evidence]",
        "  1  SR-00b002  draft  Show wind direction  [gap: no evidence]",
        "total: 5",
        "No problems.",
        "",
      ].join("\n"),
      stderr: "",
    });
    // The whole output as YAML on request.
    const yaml = await logreq(["trace", "chain", "N-00a001", "--yaml"], ws.root);
    expect(yaml.stdout).toContain("    shortId: CR-00c002\n    type: component-requirement\n");
  });

  it("[SR-022/AK1] shows a later page without nesting an element under the wrong parent (#310)", async () => {
    const ws = await fixture({ fixture: "SR-022/chain" });
    const page = await logreq(["trace", "chain", "N-00a001", "--limit", "2", "--offset", "2"], ws.root);
    expect(page.stdout.split("\n").slice(0, 3)).toEqual([
      "children:",
      `  1  SR-00b002  draft  Show wind direction  [gap: no evidence]  [under ${P}a001]`,
      // CR-00c001 derives from SR-00b001 (on the first page), not from SR-00b002 above it.
      `  2  CR-00c001  draft  Count anemometer turns  [gap: no evidence]  [under ${P}b001]`,
    ]);
  });

  it("[SR-022/AK4] marks a cycle whose closing edge starts on another page (#310)", async () => {
    const ws = await fixture({ fixture: "SR-090/cycle" });
    const page = await logreq(["trace", "chain", "N-000001", "--limit", "2"], ws.root);
    expect(page.code).toBe(0);
    expect(page.stdout.split("\n").slice(0, 3)).toEqual([
      "N-a0000000001  approved  See the wind",
      "children:",
      "  1  SR-b0000000001  draft  Show wind speed  [cycle from 5e9c0a7d-2b4f-4c61-9d08-0b0000000002]",
    ]);
    // An edge into the root from another page closes a cycle; the root has no parent in its chain.
    const up = await logreq(
      ["trace", "chain", "SR-b0000000001", "--direction", "up", "--limit", "1"],
      ws.root,
    );
    expect(up.stdout.split("\n")[0]).toBe(
      "SR-b0000000001  draft  Show wind speed  [cycle from 5e9c0a7d-2b4f-4c61-9d08-0b0000000003]",
    );
  });

  it("[SR-022/AK2] prints every parent of a component requirement up to the needs", async () => {
    const ws = await fixture({ fixture: "SR-022/chain" });
    const json = await logreq(["trace", "chain", "CR-00c002", "--direction", "up", "--json"], ws.root);
    expect(json.code).toBe(0);
    expect((JSON.parse(json.stdout) as Output).nodes.map((n) => [n.shortId, n.depth])).toEqual([
      ["CR-00c002", 0],
      ["SR-00b001", 1],
      ["SR-00b003", 1],
      ["N-00a001", 2],
      ["N-00a002", 2],
    ]);
  });

  it("[SR-022/AK3] marks the gaps: a need without a child, requirements without a child and evidence", async () => {
    const ws = await fixture({ fixture: "SR-022/chain" });
    const rain = JSON.parse(
      (await logreq(["trace", "chain", "N-00a003", "--json"], ws.root)).stdout,
    ) as Output;
    expect(rain.gaps).toEqual([{ id: `${P}a003`, repository: "system", kind: "no-child" }]);
    const wind = JSON.parse(
      (await logreq(["trace", "chain", "N-00a001", "--max-depth", "1", "--json"], ws.root)).stdout,
    ) as Output;
    expect(wind.gaps).toEqual([]);
  });

  it("[SR-022/AK4] stops at a cycle and reports it as a warning, with exit code 0", async () => {
    const ws = await fixture({
      fixture: "SR-022/chain",
      files: {
        "components/CR-00000000c002.md": [
          "---",
          `id: ${P}c002`,
          "type: component-requirement",
          "status: draft",
          "title: Report a stalled anemometer",
          "derives-from:",
          `  - { id: ${P}c001, version: ${V} }`,
          "---",
          "",
        ].join("\n"),
        "components/CR-00000000c001.md": [
          "---",
          `id: ${P}c001`,
          "type: component-requirement",
          "status: draft",
          "title: Count anemometer turns",
          "derives-from:",
          `  - { id: ${P}b001, version: ${V} }`,
          `  - { id: ${P}c002, version: ${V} }`,
          "---",
          "",
        ].join("\n"),
      },
    });
    const human = await logreq(["trace", "chain", "SR-00b001", "--direction", "down"], ws.root);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain(
      "warning  trace.cycle  system:components/CR-00000000c001.md  The chain stops at a cycle of derivations with 2 elements: Component Requirement CR-00c001, Component Requirement CR-00c002  (element CR-00c001)\n",
    );
  });
});

describe("logreq trace chain follows the meaning derivation (SR-013)", () => {
  const OWN: FixtureOptions = {
    fixture: "SR-013/own-meanings",
    files: {
      "wishes/W-0000000000f1.md":
        "---\nid: 0b0e0c0d-0013-4013-8013-0000000000f1\ntype: wish\nstatus: open\nlabel: Calm\n---\n",
      "items/SPI-0000000000f2.md": `---\nid: 0b0e0c0d-0013-4013-8013-0000000000f2\ntype: spec-item\nstatus: open\nlabel: Show calm\nsatisfies:\n  - { id: 0b0e0c0d-0013-4013-8013-0000000000f1, version: ${V} }\n---\n`,
      "items/SPI-0000000000f3.md": `---\nid: 0b0e0c0d-0013-4013-8013-0000000000f3\ntype: spec-item\nstatus: open\nlabel: Log calm\ntraces-to:\n  - { id: 0b0e0c0d-0013-4013-8013-0000000000f1, version: ${V} }\n---\n`,
    },
  };

  it("[SR-013/AK1] follows the own relation kind satisfies, not traces-to", async () => {
    const ws = await fixture(OWN);
    const json = await logreq(["trace", "chain", "W-0000f1", "--json"], ws.root);
    expect(json.code).toBe(0);
    const output = JSON.parse(json.stdout) as Output;
    expect(output.nodes.map((n) => n.shortId)).toEqual(["W-0000f1", "SPI-0000f2"]);
    expect(output.edges.map((e) => e.kind)).toEqual(["satisfies"]);
  });

  it("[SR-013/AK3] names the missing assignment of the meaning derivation, with exit code 2", async () => {
    const ws = await fixture({
      ...OWN,
      files: {
        ...OWN.files,
        "model/relations.yaml":
          "logreq-metamodel: 1\nrelations:\n  - { key: satisfies, name: Satisfies, inverse-name: Satisfied by }\n",
      },
    });
    const human = await logreq(["trace", "chain", "W-0000f1"], ws.root);
    expect(human).toEqual({
      code: 2,
      stdout: "",
      stderr:
        "error metamodel.meaning-unassigned: No relation kind of the metamodel has the meaning derivation, which trace.chain needs. Add `meaning: derivation` to a relation kind in the metamodel files.\n",
    });
  });
});
