// trace.chain through `invoke` (SR-022, SR-006 AK2, SR-013 AK1/AK3 hand-over of #25): input,
// view, errors and the output the catalog checks. The chain itself: trace/chain.test.ts. The evidence
// in the chain (SR-033, SR-022 AK1/AK3) on fixtures/SR-033/chain with records injected through
// `evidenceReadState` (#127 option 1; skipped test cases too); the record files are read end to end
// in packages/cli/test/e2e/trace-chain.test.ts.
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { EvidenceRead, EvidenceRecord, SkippedTestCase } from "../../evidence/index.js";
import { evidenceIndexState, evidenceReadState } from "../../evidence/index.js";
import { STANDARD_MODEL_TEXT as STANDARD } from "../../metamodel/standard-model.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"trace.chain">;

const P = "5c0e1d2a-0022-4022-8022-00000000";
const V = "n1:0000000000000000";
const SEE_WIND = `${P}a001`;
const TRUST = `${P}a002`;
const RAIN = `${P}a003`;
const SPEED = `${P}b001`;
const DIRECTION = `${P}b002`;
const SENSOR = `${P}b003`;
const TURNS = `${P}c001`;
const STALL = `${P}c002`;

const CHAIN: FixtureOptions = { fixture: "SR-022/chain" };

const open = async (options: FixtureOptions = CHAIN): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const chain = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.chain", input, { workspace })) as Output;

const chainError = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await chain(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected trace.chain to fail");
};

/** Nodes as `[short ID, depth, direction]`. */
const levels = (output: Output): unknown[] => output.nodes.map((n) => [n.shortId, n.depth, n.direction]);

describe("trace.chain (SR-022)", () => {
  it("[SR-022/AK1] shows every level below a need with its depth, by short ID", async () => {
    const workspace = await open();
    const output = await chain(workspace, { ref: "N-00a001" });
    expect(output.root).toBe(SEE_WIND);
    expect(levels(output)).toEqual([
      ["N-00a001", 0, undefined],
      ["SR-00b001", 1, "down"],
      ["SR-00b002", 1, "down"],
      ["CR-00c001", 2, "down"],
      ["CR-00c002", 2, "down"],
    ]);
    expect(output.edges).toHaveLength(4);
    expect([output.incomplete, output.unresolved, output.problems]).toEqual([false, [], []]);
  });

  it("[SR-022/AK2] shows every parent of a component requirement up to the needs", async () => {
    const workspace = await open();
    const output = await chain(workspace, { ref: STALL, direction: "up" });
    expect(levels(output)).toEqual([
      ["CR-00c002", 0, undefined],
      ["SR-00b001", 1, "up"],
      ["SR-00b003", 1, "up"],
      ["N-00a001", 2, "up"],
      ["N-00a002", 2, "up"],
    ]);
    expect(output.gaps).toEqual([]);
  });

  it("[SR-022/AK3] marks a need without a child and requirements without a child and evidence", async () => {
    const workspace = await open();
    expect((await chain(workspace, { ref: SEE_WIND })).gaps).toEqual([
      { id: DIRECTION, repository: "system", kind: "no-evidence" },
      { id: TURNS, repository: "system", kind: "no-evidence" },
      { id: STALL, repository: "system", kind: "no-evidence" },
    ]);
    expect((await chain(workspace, { ref: RAIN })).gaps).toEqual([
      { id: RAIN, repository: "system", kind: "no-child" },
    ]);
    // Cut at maxDepth: what lies below is not known, so it is no gap.
    const cut = await chain(workspace, { ref: SEE_WIND, maxDepth: 1 });
    expect([cut.nodes.map((n) => n.expanded), cut.gaps]).toEqual([[true, false, false], []]);
  });

  it("[SR-022/AK4] stops at a cycle and reports it as a hint", async () => {
    const component = (id: string, parents: readonly string[]): string =>
      [
        "---",
        `id: ${id}`,
        "type: component-requirement",
        "status: draft",
        "title: Part",
        "derives-from:",
        ...parents.map((p) => `  - { id: ${p}, version: ${V} }`),
        "---",
        "",
      ].join("\n");
    const workspace = await open({
      ...CHAIN,
      files: {
        "components/CR-00000000c001.md": component(TURNS, [SPEED, STALL]),
        "components/CR-00000000c002.md": component(STALL, [TURNS]),
      },
    });
    const output = await chain(workspace, { ref: SEE_WIND, direction: "both" });
    expect(levels(output)).toEqual([
      ["N-00a001", 0, undefined],
      ["SR-00b001", 1, "down"],
      ["SR-00b002", 1, "down"],
      ["CR-00c001", 2, "down"],
      ["CR-00c002", 3, "down"],
    ]);
    expect(output.edges.filter((e) => e.cyclic).map((e) => [e.source, e.target])).toEqual([
      [STALL, TURNS],
      [TURNS, STALL],
    ]);
    expect(output.problems).toEqual([
      expect.objectContaining({
        code: "trace.cycle",
        severity: "warning",
        message:
          "The chain stops at a cycle of derivations with 2 elements: Component Requirement CR-00c001, Component Requirement CR-00c002",
        elementId: TURNS,
      }),
    ]);
  });

  it("[SR-006/AK2] marks the chain incomplete while a repository of the workspace is not on this machine", async () => {
    const workspace = await open({
      ...CHAIN,
      files: {
        "logreq-workspace.yaml": [
          "logreq-workspace: 1",
          "name: Weather station",
          "repositories:",
          '  - { name: system, url: "ssh://example.com/system.git", main: true }',
          '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }',
          "metamodel: { repository: system, path: metamodel }",
          "",
        ].join("\n"),
      },
    });
    // Up: every parent is here. Down: children in vault cannot be seen (#262 option 1).
    expect((await chain(workspace, { ref: STALL, direction: "up" })).incomplete).toBe(false);
    expect((await chain(workspace, { ref: STALL, direction: "down" })).incomplete).toBe(true);
    expect((await chain(workspace, { ref: STALL })).incomplete).toBe(true);
  });

  it("follows direction and maxDepth in each direction", async () => {
    const workspace = await open();
    expect(levels(await chain(workspace, { ref: SPEED, maxDepth: 1 }))).toEqual([
      ["SR-00b001", 0, undefined],
      ["N-00a001", 1, "up"],
      ["CR-00c001", 1, "down"],
      ["CR-00c002", 1, "down"],
    ]);
    expect(levels(await chain(workspace, { ref: SPEED, maxDepth: 0 }))).toEqual([
      ["SR-00b001", 0, undefined],
    ]);
    expect(levels(await chain(workspace, { ref: SENSOR, direction: "down" }))).toEqual([
      ["SR-00b003", 0, undefined],
      ["CR-00c002", 1, "down"],
    ]);
  });

  it("gives one page of nodes with total (SR-082 AK4, spec-frage #290)", async () => {
    const workspace = await open();
    const whole = await chain(workspace, { ref: SPEED });
    expect(whole.total).toBe(whole.nodes.length);
    expect(levels(await chain(workspace, { ref: SPEED, limit: 2, offset: 1 }))).toEqual([
      ["N-00a001", 1, "up"],
      ["CR-00c001", 1, "down"],
    ]);
    // Stepping with maxDepth still works page by page.
    const step = await chain(workspace, { ref: SPEED, maxDepth: 1, limit: 1, offset: 3 });
    expect([levels(step), step.total]).toEqual([[["CR-00c002", 1, "down"]], 4]);
    for (const input of [{ limit: 0 }, { limit: 5001 }, { offset: -1 }]) {
      const error = await chainError(workspace, { ref: SPEED, ...input });
      expect(error.code).toBe("input.invalid");
    }
  });

  it("fails with ref.unknown for an element that does not exist", async () => {
    const workspace = await open();
    const error = await chainError(workspace, { ref: "SR-ffffff" });
    expect([error.code, error.details]).toEqual(["ref.unknown", { ref: "SR-ffffff" }]);
  });
});

describe("trace.chain in a view (SR-040 appliesIn)", () => {
  it("shows in the core only what has no validity, and in a variant what applies in it", async () => {
    const workspace = await open();
    const core = await chain(workspace, { ref: SEE_WIND, view: "core" });
    expect(core.nodes.map((n) => n.id)).toEqual([SEE_WIND, SPEED, TURNS, STALL]);
    const airfield = await chain(workspace, { ref: SEE_WIND, view: "VAR-00d001" });
    expect(airfield.nodes.map((n) => n.id)).toEqual([SEE_WIND, SPEED, DIRECTION, TURNS, STALL]);
    // Without a view: every element.
    expect((await chain(workspace, { ref: TRUST })).nodes.map((n) => n.id)).toEqual([TRUST, SENSOR, STALL]);
  });

  it("refuses a view that names no variant", async () => {
    const workspace = await open();
    const error = await chainError(workspace, { ref: SEE_WIND, view: "SR-00b001" });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { command: "trace.chain", fields: ["view"] },
    ]);
    expect((await chainError(workspace, { ref: SEE_WIND, view: "VAR-ffffff" })).code).toBe("ref.unknown");
  });

  it("[SR-013/AK3] names the meaning validity or variant that a view needs and no key has", async () => {
    const model = (drop: string): FixtureOptions => ({
      ...CHAIN,
      files: {
        "metamodel/standard-model.yaml": STANDARD.replace(`    meaning: ${drop}\n`, "\n"),
      },
    });
    const noValidity = await open(model("validity"));
    const error = await chainError(noValidity, { ref: SEE_WIND, view: "core" });
    expect([error.code, error.details]).toEqual([
      "metamodel.meaning-unassigned",
      { meaning: "validity", list: "properties", command: "trace.chain" },
    ]);
    const noVariant = await open(model("variant"));
    expect((await chain(noVariant, { ref: SEE_WIND, view: "core" })).nodes).toHaveLength(4);
    const variantError = await chainError(noVariant, { ref: SEE_WIND, view: "VAR-00d001" });
    expect([variantError.code, variantError.details]).toEqual([
      "metamodel.meaning-unassigned",
      { meaning: "variant", list: "types", command: "trace.chain" },
    ]);
  });
});

describe("trace.chain follows the meaning derivation (SR-013)", () => {
  const OWN: FixtureOptions = {
    fixture: "SR-013/own-meanings",
    files: {
      "wishes/W-0000000000f1.md":
        "---\nid: 0b0e0c0d-0013-4013-8013-0000000000f1\ntype: wish\nstatus: open\nlabel: Calm\n---\n",
      "items/SPI-0000000000f2.md": [
        "---",
        "id: 0b0e0c0d-0013-4013-8013-0000000000f2",
        "type: spec-item",
        "status: open",
        "label: Show calm",
        "satisfies:",
        `  - { id: 0b0e0c0d-0013-4013-8013-0000000000f1, version: ${V} }`,
        "---",
        "",
      ].join("\n"),
      "items/SPI-0000000000f3.md": [
        "---",
        "id: 0b0e0c0d-0013-4013-8013-0000000000f3",
        "type: spec-item",
        "status: open",
        "label: Log calm",
        "traces-to:",
        `  - { id: 0b0e0c0d-0013-4013-8013-0000000000f1, version: ${V} }`,
        "---",
        "",
      ].join("\n"),
    },
  };

  it("[SR-013/AK1] follows an own relation kind with the meaning derivation, and no other", async () => {
    const workspace = await open(OWN);
    const output = await chain(workspace, { ref: "W-0000f1" });
    expect(output.nodes.map((n) => [n.shortId, n.title, n.depth])).toEqual([
      ["W-0000f1", "Calm", 0],
      ["SPI-0000f2", "Show calm", 1],
    ]);
    expect(output.edges.map((e) => e.kind)).toEqual(["satisfies"]);
    // Own type keys with the meanings need and requirement: the gap is found by meaning.
    expect(output.gaps).toEqual([
      { id: "0b0e0c0d-0013-4013-8013-0000000000f2", repository: "system", kind: "no-evidence" },
    ]);
  });

  it("[SR-013/AK3] fails with metamodel.meaning-unassigned when no relation kind has the meaning derivation", async () => {
    const workspace = await open({
      ...OWN,
      files: {
        ...OWN.files,
        "model/relations.yaml":
          "logreq-metamodel: 1\nrelations:\n  - { key: satisfies, name: Satisfies, inverse-name: Satisfied by }\n",
      },
    });
    const error = await chainError(workspace, { ref: "W-0000f1" });
    expect([error.code, error.message, error.details]).toEqual([
      "metamodel.meaning-unassigned",
      "No relation kind of the metamodel has the meaning derivation, which trace.chain needs. Add `meaning: derivation` to a relation kind in the metamodel files.",
      { meaning: "derivation", list: "relations", command: "trace.chain" },
    ]);
  });
});

/** fixtures/SR-033/chain: the need N-33a001 with the leaf system requirements SR-33b001 to SR-33b004. */
const Q = "5c0e1d2a-0033-4033-8033-00000033";
const WIND = `${Q}a001`;
const SHOW = `${Q}b001`;
const LOG = `${Q}b002`;
const GUSTS = `${Q}b003`;
const DISPLAY = `${Q}b004`;
const COAST = `${Q}d001`;
const COAST_FILE = {
  "variants/VAR-00000033d001.md": `---\nid: ${COAST}\ntype: variant\nstatus: draft\ntitle: Coast edition\n---\n`,
};

/** A JUnit execution of `test_speed` (class `tests.test_wind`), as the reader gives it. */
const junit = (more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "verification",
  element: SHOW,
  version: "n1:7eb1cc5815e307fa",
  method: "test",
  item: "build-512",
  result: "passed",
  date: "2026-10-21T09:00:00Z",
  testCase: "test_speed[SR-33b001]",
  source: "junit",
  repository: "system",
  file: "evidence/ci/run-1.xml",
  line: 4,
  className: "tests.test_wind",
  ...more,
});

/** A Markdown record (no test case unless given). */
const markdown = (more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "verification",
  element: SHOW,
  version: "n1:7eb1cc5815e307fa",
  method: "inspection",
  item: "Display sample B1",
  result: "passed",
  date: "2026-10-20T14:00:00Z",
  evidence: "reports/inspection-b1.pdf",
  source: "markdown",
  repository: "system",
  file: "evidence/2026-10-20-SR-33b001-inspection.md",
  line: 1,
  ...more,
});

const skippedGusts: SkippedTestCase = {
  name: "test_gusts[SR-33b003]",
  className: "tests.test_wind",
  elements: [GUSTS],
  repository: "system",
  file: "evidence/ci/run-1.xml",
  line: 14,
};

/** A workspace on fixtures/SR-033/chain whose evidence read gives `records` and `skipped`. */
const withEvidence = async (
  records: readonly EvidenceRecord[],
  skipped: readonly SkippedTestCase[] = [],
  { incomplete = false, files = {} }: { incomplete?: boolean; files?: Record<string, string> } = {},
): Promise<Workspace> => {
  const workspace = await open({ fixture: "SR-033/chain", files });
  const read = workspace.get(evidenceReadState);
  const injected: EvidenceRead = { records, skipped, problems: [], incomplete };
  await workspace.replace(evidenceReadState, read, Promise.resolve(injected));
  return workspace;
};

/** The evidence of the output by element: `[id, depth, test cases as [name, executed, executions], records]`. */
const evidenceOf = (output: Output): unknown[] =>
  output.evidence.map((e) => [
    e.id,
    e.depth,
    e.testCases.map((t) => [t.name, t.executed, t.executions.map((r) => r.item)]),
    e.records.map((r) => r.item),
  ]);

const gapsOf = (output: Output): unknown[] => output.gaps.map((g) => [g.id, g.kind]);

describe("trace.chain: test cases and executions in the chain (SR-033)", () => {
  it("[SR-033/AK1] shows below a requirement each test case with all its executions, with date, result, item and evidence", async () => {
    const first = junit();
    const second = junit({
      item: "build-513",
      result: "failed",
      date: "2026-10-22T09:00:00Z",
      file: "evidence/ci/run-2.xml",
    });
    // Another element's execution of the same test case: never below SHOW.
    const ofLog = junit({ element: LOG, version: "n1:9e8d521db5ae313a", item: "build-512-log" });
    const tunnel = markdown({
      method: "test",
      item: "Prototype P2",
      result: "passed",
      date: "2026-10-19T10:00:00Z",
      evidence: "reports/wind-tunnel.pdf",
      testCase: "wind tunnel check",
      file: "evidence/2026-10-19-SR-33b001-test.md",
    });
    const inspection = markdown();
    const validation = markdown({ kind: "validation", item: "Pilot survey", date: "2026-10-23T10:00:00Z" });
    const workspace = await withEvidence([first, second, ofLog, tunnel, inspection, validation]);
    const output = await chain(workspace, { ref: SHOW, direction: "down" });
    expect(output.evidence).toHaveLength(1);
    const [below] = output.evidence;
    expect([below?.id, below?.repository, below?.depth]).toEqual([SHOW, "system", 1]);
    // By class name, then name: the Markdown test case has none, so it comes first.
    expect(below?.testCases).toEqual([
      {
        name: "wind tunnel check",
        elements: [SHOW],
        executed: true,
        executions: [tunnel],
        last: tunnel,
      },
      {
        name: "test_speed[SR-33b001]",
        className: "tests.test_wind",
        elements: [SHOW, LOG],
        executed: true,
        executions: [second, first],
        last: second,
      },
    ]);
    // Date, result, item and Beleg of each execution: a JUnit execution's Beleg is its record file
    // (assumption A5, #528 Q4), a Markdown execution's the `evidence` it names.
    const beleg = (r: EvidenceRecord): string =>
      r.evidence ?? `${r.repository ?? ""}/${r.file ?? ""}:${String(r.line)}`;
    expect(
      below?.testCases.flatMap((t) => t.executions.map((r) => [r.date, r.result, r.item, beleg(r)])),
    ).toEqual([
      ["2026-10-19T10:00:00Z", "passed", "Prototype P2", "reports/wind-tunnel.pdf"],
      ["2026-10-22T09:00:00Z", "failed", "build-513", "system/evidence/ci/run-2.xml:4"],
      ["2026-10-21T09:00:00Z", "passed", "build-512", "system/evidence/ci/run-1.xml:4"],
    ]);
    // The record without a test case is next to the test cases; the validation record is in neither (A2).
    expect(below?.records).toEqual([inspection]);
  });

  it("[SR-022/AK1] shows records without a test case below their requirement, one level deeper", async () => {
    const inspection = markdown({ element: DISPLAY, item: "Display sample B4" });
    const workspace = await withEvidence([inspection]);
    const output = await chain(workspace, { ref: "N-33a001" });
    expect(output.evidence).toEqual([
      { id: DISPLAY, repository: "system", depth: 2, testCases: [], records: [inspection] },
    ]);
    expect(output.nodes.find((n) => n.id === DISPLAY)?.depth).toBe(1);
  });

  it("[SR-033/AK2] shows a test case that names two requirements at each, with that requirement's executions and both in elements", async () => {
    const ofShow = junit();
    const ofLog = junit({ element: LOG, version: "n1:9e8d521db5ae313a" });
    const workspace = await withEvidence([ofShow, ofLog]);
    const output = await chain(workspace, { ref: WIND });
    expect(output.evidence.map((e) => [e.id, e.depth, e.testCases])).toEqual([
      [
        SHOW,
        2,
        [
          {
            name: ofShow.testCase,
            className: "tests.test_wind",
            elements: [SHOW, LOG],
            executed: true,
            executions: [ofShow],
            last: ofShow,
          },
        ],
      ],
      [
        LOG,
        2,
        [
          {
            name: ofShow.testCase,
            className: "tests.test_wind",
            elements: [SHOW, LOG],
            executed: true,
            executions: [ofLog],
            last: ofLog,
          },
        ],
      ],
    ]);
  });

  it("[SR-033/AK2] a test case that names two requirements closes the no-evidence gap of each", async () => {
    // Control: without records every leaf requirement is a gap.
    const none = await chain(await withEvidence([]), { ref: WIND });
    expect(gapsOf(none)).toEqual([
      [SHOW, "no-evidence"],
      [LOG, "no-evidence"],
      [GUSTS, "no-evidence"],
      [DISPLAY, "no-evidence"],
    ]);
    const workspace = await withEvidence([junit(), junit({ element: LOG, version: "n1:9e8d521db5ae313a" })]);
    expect(gapsOf(await chain(workspace, { ref: WIND }))).toEqual([
      [GUSTS, "no-evidence"],
      [DISPLAY, "no-evidence"],
    ]);
  });

  it("shows a test case of two Markdown records that share one test-case at each requirement, and closes both gaps", async () => {
    const ofShow = markdown({ method: "test", testCase: "manual wind check" });
    const ofLog = markdown({
      method: "test",
      testCase: "manual wind check",
      element: LOG,
      file: "evidence/2026-10-20-SR-33b002-test.md",
    });
    const output = await chain(await withEvidence([ofShow, ofLog]), { ref: WIND });
    expect(evidenceOf(output)).toEqual([
      [SHOW, 2, [["manual wind check", true, ["Display sample B1"]]], []],
      [LOG, 2, [["manual wind check", true, ["Display sample B1"]]], []],
    ]);
    expect(output.evidence[0]?.testCases[0]?.elements).toEqual([SHOW, LOG]);
    expect(gapsOf(output)).toEqual([
      [GUSTS, "no-evidence"],
      [DISPLAY, "no-evidence"],
    ]);
  });

  it("[SR-033/AK3] marks a test case that was only skipped as not executed", async () => {
    const workspace = await withEvidence([], [skippedGusts]);
    const output = await chain(workspace, { ref: WIND });
    expect(output.evidence).toEqual([
      {
        id: GUSTS,
        repository: "system",
        depth: 2,
        testCases: [
          {
            name: "test_gusts[SR-33b003]",
            className: "tests.test_wind",
            elements: [GUSTS],
            executed: false,
            executions: [],
          },
        ],
        records: [],
      },
    ]);
  });

  it("[SR-022/AK3] a requirement whose only test case was not executed is a no-evidence gap", async () => {
    const workspace = await withEvidence([markdown({ element: DISPLAY })], [skippedGusts]);
    const output = await chain(workspace, { ref: WIND });
    // GUSTS shows its test case and keeps the gap; DISPLAY's record file closes its gap.
    expect(output.evidence.map((e) => e.id)).toEqual([GUSTS, DISPLAY]);
    expect(gapsOf(output)).toEqual([
      [SHOW, "no-evidence"],
      [LOG, "no-evidence"],
      [GUSTS, "no-evidence"],
    ]);
  });

  it("a test case skipped in one run and executed in another is executed", async () => {
    const ran = junit({ element: GUSTS, testCase: "test_gusts[SR-33b003]", version: "n1:c784b000c0bc96b5" });
    const output = await chain(await withEvidence([ran], [skippedGusts]), { ref: GUSTS });
    expect(output.evidence[0]?.testCases).toEqual([
      {
        name: "test_gusts[SR-33b003]",
        className: "tests.test_wind",
        elements: [GUSTS],
        executed: true,
        executions: [ran],
        last: ran,
      },
    ]);
    expect(output.gaps).toEqual([]);
  });

  it("shows in a variant view only the executions for that variant and in the core those without variant", async () => {
    const core = junit();
    const coast = junit({
      item: "coast-7",
      variant: COAST,
      date: "2026-10-20T09:00:00Z",
      file: "evidence/ci/coast.xml",
    });
    const coastInspection = markdown({ item: "Coast sample", variant: COAST });
    const workspace = await withEvidence([core, coast, coastInspection], [], { files: COAST_FILE });
    expect(evidenceOf(await chain(workspace, { ref: SHOW, view: "core" }))).toEqual([
      [SHOW, 1, [["test_speed[SR-33b001]", true, ["build-512"]]], []],
    ]);
    expect(evidenceOf(await chain(workspace, { ref: SHOW, view: "VAR-33d001" }))).toEqual([
      [SHOW, 1, [["test_speed[SR-33b001]", true, ["coast-7"]]], ["Coast sample"]],
    ]);
    // Without a view, every record (each with its variant), as evidence.list.
    expect(evidenceOf(await chain(workspace, { ref: SHOW }))).toEqual([
      [SHOW, 1, [["test_speed[SR-33b001]", true, ["build-512", "coast-7"]]], ["Coast sample"]],
    ]);
  });

  it("without a view shows a variant's records and still marks the no-evidence gap in the core (#527 Q4)", async () => {
    const coast = junit({ item: "coast-7", variant: COAST });
    const workspace = await withEvidence([coast], [], { files: COAST_FILE });
    const output = await chain(workspace, { ref: SHOW });
    expect(evidenceOf(output)).toEqual([[SHOW, 1, [["test_speed[SR-33b001]", true, ["coast-7"]]], []]]);
    expect(gapsOf(output)).toEqual([[SHOW, "no-evidence"]]);
    // In the variant's view the record closes the gap; in the core the test case is left out.
    expect((await chain(workspace, { ref: SHOW, view: "VAR-33d001" })).gaps).toEqual([]);
    const inCore = await chain(workspace, { ref: SHOW, view: "core" });
    expect([inCore.evidence, gapsOf(inCore)]).toEqual([[], [[SHOW, "no-evidence"]]]);
  });

  it("gives the evidence only of the nodes of the page", async () => {
    const records = [SHOW, LOG, GUSTS, DISPLAY].map((element, i) =>
      markdown({ element, item: `sample ${String(i + 1)}` }),
    );
    const workspace = await withEvidence(records);
    const first = await chain(workspace, { ref: WIND, limit: 2 });
    expect([levels(first), evidenceOf(first)]).toEqual([
      [
        ["N-33a001", 0, undefined],
        ["SR-33b001", 1, "down"],
      ],
      [[SHOW, 2, [], ["sample 1"]]],
    ]);
    const later = await chain(workspace, { ref: WIND, limit: 2, offset: 3 });
    expect(evidenceOf(later)).toEqual([
      [GUSTS, 2, [], ["sample 3"]],
      [DISPLAY, 2, [], ["sample 4"]],
    ]);
    // Not below an element whose children were not looked at (maxDepth), as its gaps.
    const cut = await chain(workspace, { ref: WIND, maxDepth: 1 });
    expect([cut.evidence, cut.gaps]).toEqual([[], []]);
    expect((await chain(workspace, { ref: SHOW, maxDepth: 0 })).evidence).toEqual([]);
  });

  it("gives the evidence of the root of a downward chain", async () => {
    const workspace = await withEvidence([markdown()]);
    expect(evidenceOf(await chain(workspace, { ref: SHOW }))).toEqual([[SHOW, 1, [], ["Display sample B1"]]]);
    // A later page without the root and without downward nodes has none.
    expect((await chain(workspace, { ref: SHOW, offset: 1 })).evidence).toEqual([]);
  });

  it("shows no evidence and reads no records for the upward chain", async () => {
    const workspace = await open({ fixture: "SR-033/chain" });
    const output = await chain(workspace, { ref: SHOW, direction: "up" });
    expect([output.evidence, output.gaps, output.incomplete]).toEqual([[], [], false]);
    expect([workspace.peek(evidenceReadState), workspace.peek(evidenceIndexState)]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("[SR-006/AK2] marks the chain incomplete when an evidence location lies in a repository that is not on this machine", async () => {
    const workspace = await withEvidence([], [], { incomplete: true });
    expect((await chain(workspace, { ref: WIND })).incomplete).toBe(true);
    expect((await chain(workspace, { ref: WIND, direction: "down" })).incomplete).toBe(true);
    // The upward chain reads no records, so they cannot make it incomplete.
    expect((await chain(workspace, { ref: SHOW, direction: "up" })).incomplete).toBe(false);
  });
});
