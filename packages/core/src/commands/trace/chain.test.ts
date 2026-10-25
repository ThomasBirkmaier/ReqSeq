// trace.chain through `invoke` (SR-022, SR-006 AK2, SR-013 AK1/AK3 hand-over of #25): input,
// view, errors and the output the catalog checks. The chain itself: trace/chain.test.ts.
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
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
