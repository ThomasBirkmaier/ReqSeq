// The chain at core level (SR-022, #127 option 1): the chain never imports the evidence block, so the
// tests of "bis zu den Nachweisen" (AK1) and "ohne Nachweis" (AK3) give the evidence through the
// walk's leaves, `hasEvidence` and `evidenceOf` themselves. The command's own tests, with evidence
// records (SR-033), are in commands/trace/chain.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { TraceChainOutput } from "../generated/types.js";
import type { Chain, ChainOptions, ChainOutputContext } from "./chain.js";
import { chainOutput, traceChain } from "./chain.js";
import { CYCLE_NAMES_SHOWN } from "./cycles.js";
import type { DerivationGraph } from "./graph.js";
import { derivationGraph, traceContext } from "./graph.js";

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
const AIRFIELD = `${P}d001`;

const CHAIN: FixtureOptions = { fixture: "SR-022/chain" };

/** A component requirement of the fixture's kind, deriving from `parents` (UUIDs). */
const component = (id: string, parents: readonly string[], extra: readonly string[] = []): string =>
  [
    "---",
    `id: ${id}`,
    "type: component-requirement",
    "status: draft",
    "title: Part",
    "requirement-type: functional",
    "acceptance-criteria: [Given a part, then it works.]",
    "derives-from:",
    ...parents.map((p) => `  - { id: ${p}, version: ${V} }`),
    ...extra,
    "---",
    "",
  ].join("\n");

interface Opened {
  readonly graph: DerivationGraph;
  readonly record: (id: string) => ElementRecord;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = CHAIN, root = ""): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(root === "" ? fixture.root : fixture.path(root));
  onTestFinished(() => workspace.close());
  const graph = derivationGraph(await traceContext(workspace), "trace.chain");
  const store = await workspace.get(elementStoreState);
  return {
    graph,
    workspace,
    record: (id) => {
      const [found] = store.byId.get(id) ?? [];
      if (found === undefined) {
        throw new Error(`no element ${id}`);
      }
      return found;
    },
  };
};

const chainOf = <L = never>(opened: Opened, id: string, options: ChainOptions<L>): Chain<L> =>
  traceChain(opened.graph, opened.record(id), options);

/** Each walk as `[direction, [UUID, depth, expanded]...]`. */
const levels = (chain: Chain<unknown>): unknown[] =>
  chain.walks.map((w) => [w.direction, w.result.nodes.map((n) => [n.element.id, n.depth, n.expanded])]);

const gaps = (chain: Chain<unknown>): unknown[] => chain.gaps.map((g) => [g.element.id, g.kind]);

/** A record as `evidenceOf` gives it (`data-export.schema.json#/$defs/evidenceRecord`). */
const RECORD: TraceChainOutput["evidence"][number]["records"][number] = {
  element: SPEED,
  version: V,
  kind: "verification",
  method: "inspection",
  item: "sample",
  result: "passed",
  date: "2026-10-20T14:00:00Z",
};

/** An evidence record as stage 4 will read it (ADR-0012), given by the test. */
interface Evidence {
  readonly testCase: string;
  readonly result: "passed" | "failed";
}

describe("trace chain (SR-022)", () => {
  it("[SR-022/AK1] shows every level of a need down to the evidence, each with its depth", async () => {
    const opened = await open();
    const evidence: Readonly<Record<string, readonly Evidence[]>> = {
      [TURNS]: [{ testCase: "counts turns", result: "passed" }],
      [STALL]: [
        { testCase: "reports a stall", result: "passed" },
        { testCase: "reports no stall in calm", result: "failed" },
      ],
      [DIRECTION]: [{ testCase: "shows the direction", result: "passed" }],
    };
    const chain = chainOf<Evidence>(opened, SEE_WIND, {
      direction: "down",
      leaves: (e) => evidence[e.id] ?? [],
    });
    expect(levels(chain)).toEqual([
      [
        "down",
        [
          [SEE_WIND, 0, true],
          [SPEED, 1, true],
          [DIRECTION, 1, true],
          [TURNS, 2, true],
          [STALL, 2, true],
        ],
      ],
    ]);
    // The evidence one level below the element it belongs to: need 0, system requirement 1,
    // component requirement 2, evidence 3.
    expect(chain.evidence.map((e) => [e.element.id, e.depth, e.leaf.testCase])).toEqual([
      [DIRECTION, 2, "shows the direction"],
      [TURNS, 3, "counts turns"],
      [STALL, 3, "reports a stall"],
      [STALL, 3, "reports no stall in calm"],
    ]);
    expect(chain.gaps).toEqual([]);
    expect(chain.cycles).toEqual([]);
    expect(chain.incomplete).toBe(false);
    expect(chain.unassigned).toEqual([]);
  });

  it("[SR-022/AK1] gives every level with its depth and every derivation followed in the output", async () => {
    const opened = await open();
    const output = chainOutput(chainOf(opened, SEE_WIND, { direction: "both" }), {
      metamodel: opened.graph.metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    expect(output.root).toBe(SEE_WIND);
    expect(output.nodes).toEqual([
      {
        id: SEE_WIND,
        shortId: "N-00a001",
        type: "need",
        title: "See the wind",
        status: "approved",
        repository: "system",
        file: "needs/N-00000000a001.md",
        depth: 0,
        expanded: true,
      },
      expect.objectContaining({ id: SPEED, shortId: "SR-00b001", depth: 1, direction: "down" }),
      expect.objectContaining({ id: DIRECTION, depth: 1, direction: "down" }),
      expect.objectContaining({ id: TURNS, shortId: "CR-00c001", type: "component-requirement", depth: 2 }),
      expect.objectContaining({ id: STALL, title: "Report a stalled anemometer", depth: 2 }),
    ]);
    expect(output.edges).toEqual([
      {
        source: SPEED,
        sourceRepository: "system",
        target: SEE_WIND,
        targetRepository: "system",
        kind: "derives-from",
        direction: "down",
        cyclic: false,
      },
      {
        source: DIRECTION,
        sourceRepository: "system",
        target: SEE_WIND,
        targetRepository: "system",
        kind: "refines",
        direction: "down",
        cyclic: false,
      },
      {
        source: TURNS,
        sourceRepository: "system",
        target: SPEED,
        targetRepository: "system",
        kind: "derives-from",
        direction: "down",
        cyclic: false,
      },
      {
        source: STALL,
        sourceRepository: "system",
        target: SPEED,
        targetRepository: "system",
        kind: "derives-from",
        direction: "down",
        cyclic: false,
      },
    ]);
  });

  it("[SR-022/AK2] shows every parent of a component requirement up to the needs", async () => {
    const opened = await open();
    const chain = chainOf(opened, STALL, { direction: "up" });
    expect(levels(chain)).toEqual([
      [
        "up",
        [
          [STALL, 0, true],
          [SPEED, 1, true],
          [SENSOR, 1, true],
          [SEE_WIND, 2, true],
          [TRUST, 2, true],
        ],
      ],
    ]);
    // Upwards there are no gaps to look for, and no meaning is needed for them.
    expect([chain.gaps, chain.unassigned, chain.evidence]).toEqual([[], [], []]);
    const output = chainOutput(chain, {
      metamodel: opened.graph.metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    expect(output.nodes.map((n) => [n.shortId, n.depth, n.direction])).toEqual([
      ["CR-00c002", 0, undefined],
      ["SR-00b001", 1, "up"],
      ["SR-00b003", 1, "up"],
      ["N-00a001", 2, "up"],
      ["N-00a002", 2, "up"],
    ]);
    expect(output.edges.map((e) => [e.source, e.target, e.direction])).toEqual([
      [STALL, SPEED, "up"],
      [STALL, SENSOR, "up"],
      [SPEED, SEE_WIND, "up"],
      [SENSOR, TRUST, "up"],
    ]);
  });

  it("walks both ways from a system requirement: parents first, then children", async () => {
    const opened = await open();
    const chain = chainOf(opened, SPEED, { direction: "both" });
    expect(levels(chain)).toEqual([
      [
        "up",
        [
          [SPEED, 0, true],
          [SEE_WIND, 1, true],
        ],
      ],
      [
        "down",
        [
          [SPEED, 0, true],
          [TURNS, 1, true],
          [STALL, 1, true],
        ],
      ],
    ]);
  });

  it("[SR-022/AK3] marks a need without a child and a requirement without a child and without evidence", async () => {
    const opened = await open();
    expect(gaps(chainOf(opened, SEE_WIND, { direction: "both" }))).toEqual([
      [DIRECTION, "no-evidence"],
      [TURNS, "no-evidence"],
      [STALL, "no-evidence"],
    ]);
    expect(gaps(chainOf(opened, RAIN, { direction: "down" }))).toEqual([[RAIN, "no-child"]]);
    // Evidence closes the gap of a requirement; a need needs a child, evidence or not.
    const evidence = (): readonly string[] => ["record"];
    expect(gaps(chainOf(opened, SEE_WIND, { direction: "down", leaves: evidence }))).toEqual([]);
    expect(gaps(chainOf(opened, RAIN, { direction: "down", leaves: evidence }))).toEqual([
      [RAIN, "no-child"],
    ]);
    // A type with neither meaning has no gap (a variant here).
    expect(gaps(chainOf(opened, AIRFIELD, { direction: "both" }))).toEqual([]);
  });

  it("[SR-022/AK3] marks no gap where the chain was cut at maxDepth", async () => {
    const opened = await open();
    const chain = chainOf(opened, SEE_WIND, { direction: "down", maxDepth: 1 });
    expect(levels(chain)).toEqual([
      [
        "down",
        [
          [SEE_WIND, 0, true],
          [SPEED, 1, false],
          [DIRECTION, 1, false],
        ],
      ],
    ]);
    expect(chain.gaps).toEqual([]);
    // The evidence of an element whose children were not looked at is not shown either.
    expect(chainOf(opened, SEE_WIND, { direction: "down", maxDepth: 1, leaves: () => [1] }).evidence).toEqual(
      [expect.objectContaining({ depth: 1 })],
    );
    const rootOnly = chainOf(opened, RAIN, { direction: "both", maxDepth: 0 });
    expect([levels(rootOnly), rootOnly.rootExpanded, rootOnly.gaps]).toEqual([
      [
        ["up", [[RAIN, 0, false]]],
        ["down", [[RAIN, 0, false]]],
      ],
      false,
      [],
    ]);
  });

  it("[SR-022/AK3] marks a requirement as a gap whose children name a UUID that two files share (SR-088)", async () => {
    const opened = await open({
      ...CHAIN,
      files: {
        "requirements/copy/SR-00000000b001.md": component(SPEED, [SEE_WIND]).replace(
          "component-requirement",
          "system-requirement",
        ),
      },
    });
    const chain = chainOf(opened, SEE_WIND, { direction: "down" });
    const twins = chain.walks[0]?.result.nodes.filter((n) => n.element.id === SPEED) ?? [];
    expect(twins.map((n) => n.element.file)).toEqual([
      "requirements/SR-00000000b001.md",
      "requirements/copy/SR-00000000b001.md",
    ]);
    expect(gaps(chain)).toEqual([
      [SPEED, "no-evidence"],
      [DIRECTION, "no-evidence"],
      [SPEED, "no-evidence"],
    ]);
    const output = chainOutput(chain, {
      metamodel: opened.graph.metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    // The twins are two nodes, told apart only by `file`; their edges and gaps are the same (the
    // documented ambiguity of the output, SR-088).
    expect(output.nodes.filter((n) => n.id === SPEED).map((n) => n.file)).toEqual([
      "requirements/SR-00000000b001.md",
      "requirements/copy/SR-00000000b001.md",
    ]);
    const [first, second, ...others] = output.edges.filter((e) => e.source === SPEED);
    expect([others, first]).toEqual([
      [],
      {
        source: SPEED,
        sourceRepository: "system",
        target: SEE_WIND,
        targetRepository: "system",
        kind: "derives-from",
        direction: "down",
        cyclic: false,
      },
    ]);
    expect(second).toEqual(first);
    const twinGaps = output.gaps.filter((g) => g.id === SPEED);
    expect(twinGaps).toEqual([
      { id: SPEED, repository: "system", kind: "no-evidence" },
      { id: SPEED, repository: "system", kind: "no-evidence" },
    ]);
    // Each twin names the children it cannot tell apart, with their short IDs and titles.
    expect(output.unresolved).toEqual([
      ...[1, 2].flatMap(() => [
        {
          direction: "down",
          from: SPEED,
          fromRepository: "system",
          kind: "derives-from",
          id: TURNS,
          shortId: "CR-00c001",
          title: "Count anemometer turns",
          targetState: "ambiguous",
        },
        {
          direction: "down",
          from: SPEED,
          fromRepository: "system",
          kind: "derives-from",
          id: STALL,
          shortId: "CR-00c002",
          title: "Report a stalled anemometer",
          targetState: "ambiguous",
        },
      ]),
    ]);
  });

  it("[SR-022/AK4] stops at a cycle: each element once, the cycle's edges marked, one hint", async () => {
    const opened = await open({
      ...CHAIN,
      files: {
        "components/CR-00000000c001.md": component(TURNS, [SPEED, STALL]),
        "components/CR-00000000c002.md": component(STALL, [SPEED, TURNS]),
      },
    });
    const chain = chainOf(opened, SEE_WIND, { direction: "down" });
    expect(levels(chain)).toEqual([
      [
        "down",
        [
          [SEE_WIND, 0, true],
          [SPEED, 1, true],
          [DIRECTION, 1, true],
          [TURNS, 2, true],
          [STALL, 2, true],
        ],
      ],
    ]);
    expect(chain.cycles.map((c) => c.elements.map((e) => e.id))).toEqual([[TURNS, STALL]]);
    // Each has a child in the cycle: no gap.
    expect(gaps(chain)).toEqual([[DIRECTION, "no-evidence"]]);
    const output = chainOutput(chain, {
      metamodel: opened.graph.metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    expect(output.edges.filter((e) => e.cyclic).map((e) => [e.source, e.target])).toEqual([
      [STALL, TURNS],
      [TURNS, STALL],
    ]);
    expect(output.problems).toEqual([
      {
        code: "trace.cycle",
        severity: "warning",
        message:
          "The chain stops at a cycle of derivations with 2 elements: Component Requirement CR-00c001, Component Requirement CR-00c002",
        repository: "system",
        file: "components/CR-00000000c001.md",
        elementId: TURNS,
      },
    ]);
  });

  it("[SR-022/AK4] reports a cycle through the root once, though both walks find it", async () => {
    const opened = await open({
      ...CHAIN,
      files: { "components/CR-00000000c001.md": component(TURNS, [SPEED]) },
    });
    const self = await open({
      ...CHAIN,
      files: { "components/CR-00000000c001.md": component(TURNS, [SPEED, TURNS]) },
    });
    const looped = await open({
      ...CHAIN,
      files: {
        "requirements/SR-00000000b001.md": component(SPEED, [SEE_WIND, TURNS]).replace(
          "component-requirement",
          "system-requirement",
        ),
      },
    });
    expect(chainOf(opened, TURNS, { direction: "both" }).cycles).toEqual([]);
    const chain = chainOf(looped, SPEED, { direction: "both" });
    expect(chain.walks.map((w) => w.result.cycles.length)).toEqual([1, 1]);
    expect(chain.cycles.map((c) => c.elements.map((e) => e.id))).toEqual([[SPEED, TURNS]]);
    const selfChain = chainOf(self, TURNS, { direction: "both" });
    expect(selfChain.cycles.map((c) => c.elements.map((e) => e.id))).toEqual([[TURNS]]);
    expect(
      chainOutput(selfChain, {
        metamodel: self.graph.metamodel,
        shortIds: await self.workspace.get(shortIdState),
      }).problems.map((p) => p.message),
    ).toEqual(["The chain stops at a cycle: Component Requirement CR-00c001 derives from itself"]);
  });

  it("[SR-022/AK4] reports both parts of a cycle through the root when maxDepth cuts it differently for each walk", async () => {
    // R derives from A and B, A from R and C, B from A, C from R: one cycle of four. Within depth 2
    // the upward walk closes R, A, B (C is reached but not expanded), the downward walk R, A, C (B
    // is not expanded): two cycles of three elements that share two, so both are reported.
    const R = `${P}c003`;
    const A = `${P}c004`;
    const B = `${P}c005`;
    const C = `${P}c006`;
    const opened = await open({
      ...CHAIN,
      files: {
        "components/CR-00000000c003.md": component(R, [A, B]),
        "components/CR-00000000c004.md": component(A, [R, C]),
        "components/CR-00000000c005.md": component(B, [A]),
        "components/CR-00000000c006.md": component(C, [R]),
      },
    });
    const members = (cycles: readonly { readonly elements: readonly ElementRecord[] }[]): string[][] =>
      cycles.map((c) => c.elements.map((e) => e.id).sort());
    const cut = chainOf(opened, R, { direction: "both", maxDepth: 2 });
    expect(cut.walks.map((w) => members(w.result.cycles))).toEqual([[[R, A, B]], [[R, A, C]]]);
    expect(members(cut.cycles)).toEqual([
      [R, A, B],
      [R, A, C],
    ]);
    // Without the cut both walks see the whole cycle, which is reported once.
    expect(members(chainOf(opened, R, { direction: "both" }).cycles)).toEqual([[R, A, B, C]]);
  });

  it("[SR-022/AK4] reports both parts of a cycle through the root when one walk sees only some of its elements", async () => {
    // R derives from X and Y, X from Y, Y from R. Within depth 2 the upward walk closes R, X, Y, the
    // downward walk only R, Y (X is reached but not expanded): the part of two elements lies within
    // the part of three, yet it is another part, so both are reported.
    const R = `${P}c007`;
    const X = `${P}c008`;
    const Y = `${P}c009`;
    const opened = await open({
      ...CHAIN,
      files: {
        "components/CR-00000000c007.md": component(R, [X, Y]),
        "components/CR-00000000c008.md": component(X, [Y]),
        "components/CR-00000000c009.md": component(Y, [R]),
      },
    });
    const members = (cycles: readonly { readonly elements: readonly ElementRecord[] }[]): string[][] =>
      cycles.map((c) => c.elements.map((e) => e.id).sort());
    const cut = chainOf(opened, R, { direction: "both", maxDepth: 2 });
    expect(cut.walks.map((w) => members(w.result.cycles))).toEqual([[[R, X, Y]], [[R, Y]]]);
    expect(members(cut.cycles)).toEqual([
      [R, X, Y],
      [R, Y],
    ]);
  });

  it("[SR-022/AK4] reports each of several cycles", async () => {
    const opened = await open({
      ...CHAIN,
      files: {
        "components/CR-00000000c001.md": component(TURNS, [SPEED, TURNS]),
        "components/CR-00000000c002.md": component(STALL, [SPEED, SENSOR]),
        "requirements/SR-00000000b003.md": component(SENSOR, [STALL]).replace(
          "component-requirement",
          "system-requirement",
        ),
      },
    });
    const chain = chainOf(opened, SEE_WIND, { direction: "both" });
    expect(chain.cycles.map((c) => c.elements.map((e) => e.id))).toEqual([[TURNS], [STALL, SENSOR]]);
  });

  it("[SR-022/AK4] names the first elements of a long cycle and counts the rest", async () => {
    const count = CYCLE_NAMES_SHOWN + 2;
    const ids = Array.from({ length: count }, (_, i) => `${P}e${String(i).padStart(3, "0")}`);
    const files = Object.fromEntries(
      ids.map((id, i) => [
        `components/CR-${id.slice(-12)}.md`,
        component(id, [i === 0 ? SPEED : (ids[i - 1] ?? ""), ...(i === 0 ? [ids[count - 1] ?? ""] : [])]),
      ]),
    );
    const opened = await open({ ...CHAIN, files });
    const output = chainOutput(chainOf(opened, SPEED, { direction: "down" }), {
      metamodel: opened.graph.metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    const [hint] = output.problems;
    expect(hint?.message).toMatch(
      /^The chain stops at a cycle of derivations with 22 elements: Component Requirement CR-00e000, .*, Component Requirement CR-00e019, and 2 more$/,
    );
  });
  it("[SR-022/AK5] marks a requirement without a parent as a gap of the upward chain, the root's too", async () => {
    // A system requirement whose only relation is to a decision (based-on, no meaning in the standard
    // model), and a component requirement deriving from it.
    const ORPHAN = `${P}b004`;
    const DECISION = `${P}e001`;
    const opened = await open({
      ...CHAIN,
      files: {
        "decisions/D-00000000e001.md": `---\nid: ${DECISION}\ntype: decision\nstatus: draft\ntitle: Knots\n---\n`,
        "requirements/SR-00000000b004.md": `---\nid: ${ORPHAN}\ntype: system-requirement\nstatus: draft\ntitle: Orphan\nbased-on:\n  - { id: ${DECISION}, version: ${V} }\n---\n`,
        "components/CR-00000000c003.md": component(`${P}c003`, [ORPHAN]),
      },
    });
    expect(gaps(chainOf(opened, ORPHAN, { direction: "up" }))).toEqual([[ORPHAN, "no-parent"]]);
    // From below: the gap is at the element of the upward walk that has no parent; first in `gaps`.
    expect(gaps(chainOf(opened, `${P}c003`, { direction: "both" }))).toEqual([
      [ORPHAN, "no-parent"],
      [`${P}c003`, "no-evidence"],
    ]);
    // A requirement with a parent, a need and a decision have none.
    expect(gaps(chainOf(opened, STALL, { direction: "up" }))).toEqual([]);
    expect(gaps(chainOf(opened, DECISION, { direction: "up" }))).toEqual([]);
    expect(gaps(chainOf(opened, RAIN, { direction: "up" }))).toEqual([]);
    // Only where the parents were looked at: not downwards only, not at maxDepth 0.
    expect(gaps(chainOf(opened, ORPHAN, { direction: "down" }))).toEqual([[`${P}c003`, "no-evidence"]]);
    expect(gaps(chainOf(opened, ORPHAN, { direction: "up", maxDepth: 0 }))).toEqual([]);
    // Whatever the view: a parent that does not apply in it is still a parent.
    expect(gaps(chainOf(opened, STALL, { direction: "up", includes: (e) => e.id === STALL }))).toEqual([]);
  });

  it("[SR-022/AK5] takes a parent of any relation kind with the meaning derivation, also one of the project's own", async () => {
    const DECISION = `${P}e001`;
    const decided = `---\nid: ${SPEED}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\ndecided-by:\n  - { id: ${DECISION}, version: ${V} }\n---\n`;
    const opened = await open({
      ...CHAIN,
      files: {
        "decisions/D-00000000e001.md": `---\nid: ${DECISION}\ntype: decision\nstatus: draft\ntitle: Knots\n---\n`,
        "requirements/SR-00000000b001.md": decided,
        "metamodel/origin.yaml": [
          "reqseq-metamodel: 1",
          "relations:",
          "  - key: decided-by",
          "    name: Decided by",
          "    target-types: [decision]",
          "    meaning: derivation",
          "",
        ].join("\n"),
      },
    });
    const chain = chainOf(opened, SPEED, { direction: "up" });
    expect(levels(chain)).toEqual([
      [
        "up",
        [
          [SPEED, 0, true],
          [DECISION, 1, true],
        ],
      ],
    ]);
    expect(chain.gaps).toEqual([]);
    // DIRECTION refines its need (refines has the meaning derivation too).
    expect(gaps(chainOf(opened, DIRECTION, { direction: "up" }))).toEqual([]);
  });
});

describe("trace chain in a view and with missing repositories", () => {
  it("leaves out what does not apply in the view, and what is reached only through it", async () => {
    const opened = await open();
    const core = (e: ElementRecord): boolean => e.id !== DIRECTION && e.id !== SENSOR;
    const down = chainOf(opened, SEE_WIND, { direction: "down", includes: core });
    expect(down.walks[0]?.result.nodes.map((n) => n.element.id)).toEqual([SEE_WIND, SPEED, TURNS, STALL]);
    const up = chainOf(opened, STALL, { direction: "up", includes: core });
    expect(up.walks[0]?.result.nodes.map((n) => n.element.id)).toEqual([STALL, SPEED, SEE_WIND]);
    // The root is the start in any view.
    const outside = chainOf(opened, DIRECTION, { direction: "both", includes: core });
    expect(outside.walks.map((w) => w.result.nodes.map((n) => n.element.id))).toEqual([
      [DIRECTION, SEE_WIND],
      [DIRECTION],
    ]);
  });

  it("leaves out unresolved children that do not apply in the view", async () => {
    const opened = await open({
      ...CHAIN,
      files: {
        "requirements/copy/SR-00000000b001.md": component(SPEED, [SEE_WIND]).replace(
          "component-requirement",
          "system-requirement",
        ),
      },
    });
    const chain = chainOf(opened, SEE_WIND, { direction: "down", includes: (e) => e.id !== TURNS });
    expect(chain.walks[0]?.result.unresolved.map((u) => u.link.source.id)).toEqual([STALL, STALL]);
  });

  it("[SR-006/AK2] marks the chain incomplete, up where a parent is not on this machine and down always then", async () => {
    const away = "  - { name: away, url: git@example.com:away.git, path: ../away }";
    const fixture = await open({
      ...CHAIN,
      files: {
        "reqseq-workspace.yaml": [
          "reqseq-workspace: 1",
          "name: Weather station",
          "repositories:",
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
          away,
          "metamodel: { repository: system, path: metamodel }",
          "",
        ].join("\n"),
        "components/CR-00000000c001.md": component(
          TURNS,
          [SPEED],
          [
            "refines:",
            `  - { id: ${P}f001, version: ${V}, repository: away }`,
            `  - { id: ${P}f002, version: ${V} }`,
            "  - { id: not-a-uuid, version: n1:0000000000000000, repository: away }",
          ],
        ),
      },
    });
    const shortIds = await fixture.workspace.get(shortIdState);
    const up = chainOf(fixture, TURNS, { direction: "up" });
    expect(up.incomplete).toBe(true);
    expect(chainOutput(up, { metamodel: fixture.graph.metamodel, shortIds }).unresolved).toEqual([
      {
        direction: "up",
        from: TURNS,
        fromRepository: "system",
        kind: "refines",
        id: `${P}f001`,
        shortId: `UNKNOWN-${shortIds.tail(`${P}f001`)}`,
        targetState: "inaccessible",
      },
      {
        direction: "up",
        from: TURNS,
        fromRepository: "system",
        kind: "refines",
        id: `${P}f002`,
        targetState: "missing",
      },
    ]);
    // A missing parent alone (SR-089) leaves the upward chain complete.
    expect(chainOf(fixture, STALL, { direction: "up" }).incomplete).toBe(false);
    // Downwards children in a repository that is not here cannot be seen (#262 option 1).
    expect(chainOf(fixture, STALL, { direction: "down" }).incomplete).toBe(true);
  });

  it("[SR-022/AK5] counts a parent in a repository that is not on this machine, and a missing one, as a parent", async () => {
    const opened = await open({
      ...CHAIN,
      files: {
        "reqseq-workspace.yaml": [
          "reqseq-workspace: 1",
          "name: Weather station",
          "repositories:",
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
          "  - { name: away, url: git@example.com:away.git, path: ../away }",
          "metamodel: { repository: system, path: metamodel }",
          "",
        ].join("\n"),
        "components/CR-00000000c001.md": component(
          TURNS,
          [],
          ["refines:", `  - { id: ${P}f001, version: ${V}, repository: away }`],
        ),
        "components/CR-00000000c002.md": component(STALL, [`${P}f002`]),
      },
    });
    expect(gaps(chainOf(opened, TURNS, { direction: "up" }))).toEqual([]);
    expect(gaps(chainOf(opened, STALL, { direction: "up" }))).toEqual([]);
  });
});

describe("trace chain output", () => {
  it("[SR-022/AK5] gives a no-parent gap with the page of its node in the upward walk", async () => {
    const ORPHAN = `${P}b004`;
    const CHILD = `${P}c003`;
    const opened = await open({
      ...CHAIN,
      files: {
        "requirements/SR-00000000b004.md": `---\nid: ${ORPHAN}\ntype: system-requirement\nstatus: draft\ntitle: Orphan\n---\n`,
        "components/CR-00000000c003.md": component(CHILD, [ORPHAN]),
      },
    });
    const context = { metamodel: opened.graph.metamodel, shortIds: await opened.workspace.get(shortIdState) };
    const chain = chainOf(opened, CHILD, { direction: "both" });
    const gapsOn = (page?: { limit: number; offset: number }): unknown[] =>
      chainOutput(chain, context, page).gaps.map((g) => [g.id, g.kind]);
    expect(gapsOn()).toEqual([
      [ORPHAN, "no-parent"],
      [CHILD, "no-evidence"],
    ]);
    expect(gapsOn({ limit: 1, offset: 0 })).toEqual([[CHILD, "no-evidence"]]);
    expect(gapsOn({ limit: 1, offset: 1 })).toEqual([[ORPHAN, "no-parent"]]);
    // The root's own gap is on the first page, with the root.
    const root = chainOf(opened, ORPHAN, { direction: "both" });
    expect(chainOutput(root, context, { limit: 1, offset: 0 }).gaps).toEqual([
      { id: ORPHAN, repository: "system", kind: "no-parent" },
    ]);
  });

  it("names the repository of every end, also across repositories (D-058)", async () => {
    const workspaceFile = [
      "reqseq-workspace: 1",
      "name: Two",
      "repositories:",
      '  - { name: system, url: "ssh://example.com/system.git", main: true }',
      '  - { name: platform, url: "ssh://example.com/platform.git", path: ../platform }',
      "metamodel: { repository: system, path: metamodel }",
      "",
    ].join("\n");
    const opened = await open(
      {
        files: {
          "system/reqseq-workspace.yaml": workspaceFile,
          "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
          "system/needs/N-00000000a001.md": `---\nid: ${SEE_WIND}\ntype: need\nstatus: draft\ntitle: See the wind\n---\n`,
          "platform/requirements/SR-00000000b001.md": `---\nid: ${SPEED}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\nderives-from:\n  - { id: ${SEE_WIND}, version: ${V}, repository: system }\n---\n`,
        },
      },
      "system",
    );
    const output = chainOutput(chainOf(opened, SEE_WIND, { direction: "down" }), {
      metamodel: opened.graph.metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    expect([output.nodes.map((n) => [n.id, n.repository]), output.edges, output.gaps]).toEqual([
      [
        [SEE_WIND, "system"],
        [SPEED, "platform"],
      ],
      [
        {
          source: SPEED,
          sourceRepository: "platform",
          target: SEE_WIND,
          targetRepository: "system",
          kind: "derives-from",
          direction: "down",
          cyclic: false,
        },
      ],
      [{ id: SPEED, repository: "platform", kind: "no-evidence" }],
    ]);
  });

  it("names the meanings no type has, against a valid metamodel only (SR-013 AK3)", async () => {
    const opened = await open();
    const shortIds = await opened.workspace.get(shortIdState);
    const chain = {
      ...chainOf(opened, RAIN, { direction: "down" }),
      unassigned: ["need", "requirement"] as const,
    };
    const valid = chainOutput(chain, { metamodel: opened.graph.metamodel, shortIds });
    expect(valid.problems.map((p) => [p.code, p.severity, p.message])).toEqual([
      [
        "metamodel.meaning-unassigned",
        "warning",
        "No type of the metamodel has the meaning need, which trace.chain needs. Add `meaning: need` to a type in the metamodel files.",
      ],
      [
        "metamodel.meaning-unassigned",
        "warning",
        "No type of the metamodel has the meaning requirement, which trace.chain needs. Add `meaning: requirement` to a type in the metamodel files.",
      ],
    ]);
    const invalid: Metamodel = { ...opened.graph.metamodel, valid: false };
    expect(chainOutput(chain, { metamodel: invalid, shortIds }).problems).toEqual([]);
  });

  it("finds the gaps of the meanings the metamodel has", async () => {
    const opened = await open();
    const noNeed: DerivationGraph = {
      ...opened.graph,
      metamodel: {
        ...opened.graph.metamodel,
        meanings: { ...opened.graph.metamodel.meanings, need: [] },
        effectiveTypes: opened.graph.metamodel.effectiveTypes.filter((t) => t.meaning !== "need"),
      },
    };
    const chain = traceChain(noNeed, opened.record(RAIN), { direction: "down" });
    expect([chain.unassigned, chain.gaps]).toEqual([["need"], []]);
  });

  it("gives empty titles without the meaning title, and no status where the file has none", async () => {
    const opened = await open({
      ...CHAIN,
      files: { "needs/N-00000000a003.md": `---\nid: ${RAIN}\ntype: need\ntitle: See the rain\n---\n` },
    });
    const metamodel: Metamodel = {
      ...opened.graph.metamodel,
      properties: opened.graph.metamodel.properties.filter((p) => p.meaning !== "title"),
    };
    const output = chainOutput(chainOf(opened, RAIN, { direction: "up" }), {
      metamodel,
      shortIds: await opened.workspace.get(shortIdState),
    });
    expect(output.nodes).toEqual([
      {
        id: RAIN,
        shortId: "N-00a003",
        type: "need",
        title: "",
        repository: "system",
        file: "needs/N-00000000a003.md",
        depth: 0,
        expanded: true,
      },
    ]);
  });

  describe("pages (SR-082 AK4, spec-frage #290)", () => {
    /** Every page of `size` nodes of `chain`, from the first on. */
    const pagesOf = (
      chain: Chain<unknown>,
      context: ChainOutputContext,
      size: number,
    ): TraceChainOutput[] => {
      const pages = [chainOutput(chain, context, { limit: size, offset: 0 })];
      for (let offset = size; offset < (pages[0]?.total ?? 0); offset += size) {
        pages.push(chainOutput(chain, context, { limit: size, offset }));
      }
      for (const page of pages) {
        expect(page.nodes.length).toBeLessThanOrEqual(size);
      }
      return pages;
    };
    const sorted = (items: readonly object[]): string[] => items.map((i) => JSON.stringify(i)).sort();

    it.each([
      ["a need down with its gaps, and a requirement up", CHAIN, SPEED, 2],
      [
        "a root with two ancestors and three children, one node a page",
        {
          ...CHAIN,
          files: {
            "components/CR-00000000c003.md": component(`${P}c003`, [TURNS]),
            "components/CR-00000000c004.md": component(`${P}c004`, [TURNS]),
            "components/CR-00000000c005.md": component(`${P}c005`, [TURNS]),
          },
        },
        TURNS,
        1,
      ],
      [
        "a cycle through the root, with an edge back to it",
        {
          ...CHAIN,
          files: {
            "requirements/SR-00000000b001.md": component(SPEED, [SEE_WIND, TURNS]).replace(
              "component-requirement",
              "system-requirement",
            ),
          },
        },
        SPEED,
        2,
      ],
      [
        "unresolved children of the root (SR-088)",
        {
          ...CHAIN,
          files: {
            "requirements/copy/SR-00000000b001.md": component(SPEED, [SEE_WIND]).replace(
              "component-requirement",
              "system-requirement",
            ),
          },
        },
        SEE_WIND,
        2,
      ],
    ])("splits %s into pages that together give the whole chain", async (_name, options, root, size) => {
      const opened = await open(options);
      const context = {
        metamodel: opened.graph.metamodel,
        shortIds: await opened.workspace.get(shortIdState),
      };
      const chain = chainOf(opened, root, { direction: "both" });
      const whole = chainOutput(chain, context);
      const pages = pagesOf(chain, context, size);
      expect(pages.length).toBeGreaterThan(1);
      // No node on two pages (twins of SR-088 are told apart by their file).
      const nodeKeys = pages.flatMap((p) => p.nodes.map((n) => [n.id, n.file, n.direction].join(" ")));
      expect(new Set(nodeKeys).size).toBe(nodeKeys.length);
      // No edge on two pages: as many as the whole chain has (twins name their edges the same way).
      expect(pages.flatMap((p) => p.edges)).toHaveLength(whole.edges.length);
      // Nodes and gaps in the order of the whole chain; each edge and unresolved relation on one page.
      expect(pages.flatMap((p) => p.nodes)).toEqual(whole.nodes);
      expect(pages.flatMap((p) => p.gaps)).toEqual(whole.gaps);
      expect(sorted(pages.flatMap((p) => p.edges))).toEqual(sorted(whole.edges));
      expect(sorted(pages.flatMap((p) => p.unresolved))).toEqual(sorted(whole.unresolved));
      // What belongs to the whole chain is on every page.
      for (const page of pages) {
        expect(page).toMatchObject({
          root,
          total: whole.nodes.length,
          incomplete: whole.incomplete,
          problems: whole.problems,
        });
      }
    });

    it("lists the edges that lead to the nodes of the page, in their walk", async () => {
      const opened = await open();
      const context = {
        metamodel: opened.graph.metamodel,
        shortIds: await opened.workspace.get(shortIdState),
      };
      // Up: SEE_WIND; down: TURNS, STALL.
      const chain = chainOf(opened, SPEED, { direction: "both" });
      const second = chainOutput(chain, context, { limit: 2, offset: 1 });
      expect(second.nodes.map((n) => [n.id, n.direction])).toEqual([
        [SEE_WIND, "up"],
        [TURNS, "down"],
      ]);
      expect(second.edges.map((e) => [e.source, e.target, e.direction])).toEqual([
        [SPEED, SEE_WIND, "up"],
        [TURNS, SPEED, "down"],
      ]);
      expect(second.gaps).toEqual([{ id: TURNS, repository: "system", kind: "no-evidence" }]);
      expect(second.total).toBe(4);
      // Past the end: no nodes, the total still.
      const past = chainOutput(chain, context, { limit: 2, offset: 4 });
      expect([past.nodes, past.edges, past.gaps, past.total]).toEqual([[], [], [], 4]);
    });
  });

  it("hasEvidence decides the gap when given, asked only for a requirement without a child", async () => {
    const opened = await open();
    const asked: string[] = [];
    const chain = chainOf(opened, SEE_WIND, {
      direction: "down",
      // Leaves alone would close every gap; with hasEvidence they decide nothing.
      leaves: () => ["leaf"],
      hasEvidence: (e) => {
        asked.push(e.id);
        return e.id === TURNS;
      },
    });
    expect(gaps(chain)).toEqual([
      [DIRECTION, "no-evidence"],
      [STALL, "no-evidence"],
    ]);
    expect(asked).toEqual([DIRECTION, TURNS, STALL]);
  });

  it("chainOutput lists the evidence of the expanded down nodes of the page with their depth", async () => {
    const opened = await open();
    const shortIds = await opened.workspace.get(shortIdState);
    const asked: string[] = [];
    const context: ChainOutputContext = {
      metamodel: opened.graph.metamodel,
      shortIds,
      evidenceOf: (e) => {
        asked.push(e.id);
        return e.id === SEE_WIND || e.id === SPEED
          ? undefined
          : { testCases: [], records: [{ ...RECORD, element: e.id }] };
      },
    };
    // Up: SEE_WIND; down: TURNS, STALL (SR-022/chain: both at depth 1 below SPEED).
    const chain = chainOf(opened, SPEED, { direction: "both" });
    const whole = chainOutput(chain, context);
    expect(whole.evidence.map((e) => [e.id, e.repository, e.depth, e.records.map((r) => r.element)])).toEqual(
      [
        [TURNS, "system", 2, [TURNS]],
        [STALL, "system", 2, [STALL]],
      ],
    );
    // Asked for the root of the down walk and its down nodes only, never for an upward node.
    expect(asked).toEqual([SPEED, TURNS, STALL]);
    asked.length = 0;
    const second = chainOutput(chain, context, { limit: 2, offset: 2 });
    expect([second.nodes.map((n) => n.id), second.evidence.map((e) => e.id), asked]).toEqual([
      [TURNS, STALL],
      [TURNS, STALL],
      [TURNS, STALL],
    ]);
    // Not below a node whose children were not looked at; none without evidenceOf.
    asked.length = 0;
    const cut = chainOutput(chainOf(opened, SPEED, { direction: "down", maxDepth: 1 }), context);
    expect([cut.evidence.map((e) => e.id), asked]).toEqual([[], [SPEED]]);
    expect(chainOutput(chain, { metamodel: opened.graph.metamodel, shortIds }).evidence).toEqual([]);
  });
});
