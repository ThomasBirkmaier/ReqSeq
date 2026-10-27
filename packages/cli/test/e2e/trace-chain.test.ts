// `logreq trace chain` end to end (SR-022, ADR-0009): the built binary with the product commands on
// fixture workspaces, its exit code, its JSON and its readable output. Also the tests SR-013 handed
// over to this command (#25: AK1 and AK3, #127 option 1). The evidence in the chain (SR-022 AK1, AK3;
// SR-033) on fixtures/SR-033/chain: test cases and executions read from JUnit and Markdown record
// files in its evidence location.
// Run after `pnpm build` with `pnpm test:e2e`.
import { rm } from "node:fs/promises";
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

/** fixtures/SR-033/chain: N-33a001 with the leaf system requirements SR-33b001 to SR-33b004. */
const Q = "5c0e1d2a-0033-4033-8033-00000033";

interface Execution {
  readonly date: string;
  readonly result: string;
  readonly item: string;
  readonly evidence?: string;
  readonly repository?: string;
  readonly file?: string;
  readonly line?: number;
}

interface TestCase {
  readonly name: string;
  readonly className?: string;
  readonly elements: readonly string[];
  readonly executed: boolean;
  readonly executions: readonly Execution[];
}

interface WithEvidence extends Output {
  readonly evidence: readonly {
    readonly id: string;
    readonly depth: number;
    readonly testCases: readonly TestCase[];
    readonly records: readonly Execution[];
  }[];
}

/** `logreq trace chain <ref> --json` on `ws`. */
const chainJson = async (ws: FixtureWorkspace, ref: string): Promise<WithEvidence> => {
  const run = await logreq(["trace", "chain", ref, "--json"], ws.root);
  expect([run.code, run.stderr]).toEqual([0, ""]);
  return JSON.parse(run.stdout) as WithEvidence;
};

/** Each execution as `[date, result, item, Beleg]`: its `evidence`, else its record file (A5, #528 Q4). */
const fields = (e: Execution): unknown[] => [
  e.date,
  e.result,
  e.item,
  e.evidence ?? `${e.repository ?? ""}/${e.file ?? ""}:${String(e.line)}`,
];

describe("logreq trace chain: test cases and executions (SR-033)", () => {
  it("[SR-033/AK1] logreq trace chain shows test cases and executions read from JUnit and Markdown record files", async () => {
    const ws = await fixture({
      fixture: "SR-033/chain",
      files: {
        "evidence/2026-10-19-SR-33b001-test.md": [
          "---",
          "logreq-record: 1",
          "kind: verification",
          `element: ${Q}b001`,
          "version: n1:7eb1cc5815e307fa",
          "method: test",
          "item: Prototype P2",
          "result: passed",
          "date: 2026-10-19T10:00:00Z",
          "evidence: reports/wind-tunnel.pdf",
          "test-case: wind tunnel check",
          "---",
          "",
        ].join("\n"),
      },
    });
    const output = await chainJson(ws, "SR-33b001");
    expect(output.evidence.map((e) => [e.id, e.depth])).toEqual([[`${Q}b001`, 1]]);
    const [below] = output.evidence;
    expect(below?.testCases.map((t) => [t.className, t.name, t.executed, t.executions.map(fields)])).toEqual([
      [
        undefined,
        "wind tunnel check",
        true,
        [["2026-10-19T10:00:00Z", "passed", "Prototype P2", "reports/wind-tunnel.pdf"]],
      ],
      [
        "tests.test_wind",
        "test_speed[SR-33b001]",
        true,
        [
          ["2026-10-22T09:00:00Z", "failed", "build-513", "system/evidence/ci/run-2.xml:4"],
          ["2026-10-21T09:00:00Z", "passed", "build-512", "system/evidence/ci/run-1.xml:4"],
        ],
      ],
    ]);
    expect(below?.records).toEqual([]);
    const human = await logreq(["trace", "chain", "SR-33b001", "--direction", "down"], ws.root);
    expect(human).toEqual({
      code: 0,
      stdout: [
        "SR-33b001  draft  Show wind speed",
        "  1  test case  wind tunnel check",
        "       2026-10-19T10:00:00Z  passed  Prototype P2  reports/wind-tunnel.pdf",
        "  1  test case  tests.test_wind › test_speed[SR-33b001]",
        "       2026-10-22T09:00:00Z  failed  build-513  system/evidence/ci/run-2.xml:4",
        "       2026-10-21T09:00:00Z  passed  build-512  system/evidence/ci/run-1.xml:4",
        "total: 1",
        "No problems.",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("[SR-022/AK1] logreq trace chain shows every level of a need down to the record files, with their depth", async () => {
    const ws = await fixture({ fixture: "SR-033/chain" });
    const output = await chainJson(ws, "N-33a001");
    expect(output.nodes.map((n) => [n.shortId, n.depth])).toEqual([
      ["N-33a001", 0],
      ["SR-33b001", 1],
      ["SR-33b002", 1],
      ["SR-33b003", 1],
      ["SR-33b004", 1],
    ]);
    expect(output.evidence.map((e) => [e.id, e.depth, e.testCases.length, e.records.length])).toEqual([
      [`${Q}b001`, 2, 1, 0],
      [`${Q}b002`, 2, 1, 0],
      [`${Q}b003`, 2, 1, 0],
      [`${Q}b004`, 2, 0, 1],
    ]);
    expect(output.evidence[3]?.records.map(fields)).toEqual([
      ["2026-10-20T14:00:00Z", "passed", "Display sample B4", "reports/inspection-b4.pdf"],
    ]);
    const human = await logreq(["trace", "chain", "N-33a001"], ws.root);
    expect(human).toEqual({
      code: 0,
      stdout: [
        "N-33a001  approved  See the wind",
        "children:",
        "  1  SR-33b001  draft  Show wind speed",
        "  2    test case  tests.test_wind › test_speed[SR-33b001]",
        "         2026-10-22T09:00:00Z  failed  build-513  system/evidence/ci/run-2.xml:4",
        "         2026-10-21T09:00:00Z  passed  build-512  system/evidence/ci/run-1.xml:4",
        "  1  SR-33b002  draft  Log wind speed",
        "  2    test case  tests.test_wind › test_speed[SR-33b001]",
        "         2026-10-21T09:00:00Z  passed  build-512  system/evidence/ci/run-1.xml:4",
        "  1  SR-33b003  draft  Show gusts  [gap: no evidence]",
        "  2    test case  tests.test_wind › test_gusts[SR-33b003]  [not executed]",
        "  1  SR-33b004  draft  Show the wind on the display",
        "  2    record  2026-10-20T14:00:00Z  inspection  passed  Display sample B4  reports/inspection-b4.pdf",
        "total: 5",
        "No problems.",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  it("[SR-033/AK2] logreq trace chain shows a JUnit test case that names two requirements at both", async () => {
    const ws = await fixture({ fixture: "SR-033/chain" });
    const output = await chainJson(ws, "N-33a001");
    // One <testcase> of run-1.xml names SR-33b001 and SR-33b002: shown at each, with its own executions.
    const speed = (id: string): unknown =>
      output.evidence
        .find((e) => e.id === id)
        ?.testCases.map((t) => [t.name, t.elements, t.executions.map((e) => [e.item, e.file, e.line])]);
    expect(speed(`${Q}b001`)).toEqual([
      [
        "test_speed[SR-33b001]",
        [`${Q}b001`, `${Q}b002`],
        [
          ["build-513", "evidence/ci/run-2.xml", 4],
          ["build-512", "evidence/ci/run-1.xml", 4],
        ],
      ],
    ]);
    expect(speed(`${Q}b002`)).toEqual([
      ["test_speed[SR-33b001]", [`${Q}b001`, `${Q}b002`], [["build-512", "evidence/ci/run-1.xml", 4]]],
    ]);
    // It counts for each: neither leaf requirement has a no-evidence gap ...
    expect(output.gaps.map((g) => g.id)).toEqual([`${Q}b003`]);
    // ... and the coverage counts both with evidence.
    const coverage = await logreq(["evidence", "coverage", "--json"], ws.root);
    const level = (
      JSON.parse(coverage.stdout) as {
        levels: { type: string; elements: { withEvidence: string[] } }[];
      }
    ).levels.find((l) => l.type === "system-requirement");
    expect(level?.elements.withEvidence).toEqual([`${Q}b001`, `${Q}b002`, `${Q}b004`]);
  });

  it("[SR-033/AK3] logreq trace chain marks a skipped JUnit test case as not executed", async () => {
    const ws = await fixture({ fixture: "SR-033/chain" });
    const output = await chainJson(ws, "SR-33b003");
    expect(output.evidence).toEqual([
      {
        id: `${Q}b003`,
        repository: "system",
        depth: 1,
        testCases: [
          {
            name: "test_gusts[SR-33b003]",
            className: "tests.test_wind",
            elements: [`${Q}b003`],
            executed: false,
            executions: [],
          },
        ],
        records: [],
      },
    ]);
    const human = await logreq(["trace", "chain", "SR-33b003"], ws.root);
    expect(human.stdout.split("\n").slice(0, 2)).toEqual([
      "SR-33b003  draft  Show gusts  [gap: no evidence]",
      "  1  test case  tests.test_wind › test_gusts[SR-33b003]  [not executed]",
    ]);
  });

  it("[SR-022/AK3] logreq trace chain marks a gap at a requirement whose test case was skipped, and none at one with a record file", async () => {
    const ws = await fixture({ fixture: "SR-033/chain" });
    const gaps = async (): Promise<unknown[]> =>
      (await chainJson(ws, "N-33a001")).gaps.map((g) => [g.id, g.kind]);
    expect(await gaps()).toEqual([[`${Q}b003`, "no-evidence"]]);
    // Control: without its record file SR-33b004 is a gap too.
    await rm(ws.path("evidence/2026-10-20-SR-33b004-inspection.md"));
    expect(await gaps()).toEqual([
      [`${Q}b003`, "no-evidence"],
      [`${Q}b004`, "no-evidence"],
    ]);
  });
});
