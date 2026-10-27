// trace.graph through `invoke` (SR-111, D-063) on fixtures/SR-111/graph: the data of AK1 to AK4, the
// truncation contract and the marks against element.get and trace.chain. S1 is the element: it
// derives from N1, is based on D1, is in PKG, supersedes O1 (obsolete) and references D2 with an
// outdated version. C1, C2 and C3 derive from S1 (C2's version is outdated), C3 also from C1, G1 from
// C1, GG1 from G1 (valid only in the variant V1). D1 references S1 (so it is above and below S1), D2
// references C1 (a link from a parent to a child), E1 references S1, C1 is based on D1 (a link the
// walks do not take) and G1 references itself.
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"trace.graph">;

const P = "5e111a7d-2b4f-4c61-9d08-";
const ID = {
  S1: `${P}0b0000000001`,
  O1: `${P}0b0000000002`,
  N1: `${P}0a0000000001`,
  D1: `${P}0d0000000001`,
  D2: `${P}0d0000000002`,
  E1: `${P}0d0000000003`,
  PKG: `${P}0e0000000001`,
  C1: `${P}0c0000000001`,
  C2: `${P}0c0000000002`,
  C3: `${P}0c0000000003`,
  G1: `${P}0c0000000004`,
  GG1: `${P}0c0000000005`,
  V1: `${P}0f0000000001`,
} as const;
type Name = keyof typeof ID;
const NAME = new Map<string, Name>((Object.entries(ID) as [Name, string][]).map(([name, id]) => [id, name]));
const nameOf = (id: string): string => NAME.get(id) ?? id;

const open = async (change?: (fixture: FixtureWorkspace) => Promise<void>): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-111/graph" });
  onTestFinished(() => fixture.cleanup());
  await change?.(fixture);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const graph = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.graph", input, { workspace })) as Output;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await graph(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected trace.graph to fail");
};

/** D2's text also references E1, so the up walk reaches E1 (at -2) before the down walk (at +1). */
const withD2ReferencingE1 = async (fixture: FixtureWorkspace): Promise<void> => {
  const { readFile } = await import("node:fs/promises");
  const file = "decisions/D-0d0000000002.md";
  const text = await readFile(fixture.path(file), "utf8");
  await fixture.write(file, `${text}See also [the display](logreq:${ID.E1}).\n`);
};

type Level = [string, number];

/** Nodes as `[name, level]`. */
const levels = (output: Output): Level[] => output.nodes.map((n) => [nameOf(n.id), n.level]);

/** Nodes as `[name, level, expanded]`. */
const expansion = (output: Output): [string, number, boolean][] =>
  output.nodes.map((n) => [nameOf(n.id), n.level, n.expanded]);

/** Edges as `[source, target, link, kind, meaning, outdated]`; `-` for an absent field. */
const edges = (output: Output): [string, string, string, string, string, boolean][] =>
  output.edges.map((e) => [
    nameOf(e.source),
    nameOf(e.target),
    e.link,
    e.kind ?? "-",
    e.meaning ?? "-",
    e.outdated,
  ]);

/** The names of the nodes that carry `mark`. */
const marked = (output: Output, mark: Output["nodes"][number]["marks"][number]): string[] =>
  output.nodes.filter((n) => n.marks.includes(mark)).map((n) => nameOf(n.id));

/** Every node of the whole graph of S1, in order: the element, then by distance, above before below. */
const ALL_LEVELS: Level[] = [
  ["S1", 0],
  ["N1", -1],
  ["D1", -1],
  ["PKG", -1],
  ["O1", -1],
  ["D2", -1],
  ["C1", 1],
  ["C2", 1],
  ["C3", 1],
  ["E1", 1],
  ["G1", 2],
  ["GG1", 3],
];

describe("trace.graph (SR-111)", () => {
  it("[SR-111/AK1] the element is the one node at level 0, what it links to at negative levels, what links to it at positive levels", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1 });
    expect(output.root).toBe(ID.S1);
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 10));
    // D1 is reached both ways (S1 is based on it, its text references S1): one node, above on a tie.
    expect(output.nodes.filter((n) => n.id === ID.D1)).toHaveLength(1);
    expect(output.nodes.filter((n) => n.level === 0).map((n) => nameOf(n.id))).toEqual(["S1"]);
    expect([output.truncated, output.incomplete, output.problems]).toEqual([false, false, []]);
  });

  it("[SR-111/AK1] places an element at its smaller distance, and a link against the levels stays an edge", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, maxDepth: 2 });
    // C1 is two steps up (S1 references D2, D2 references C1) and one step down: below S1.
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 11));
    expect(edges(output)).toContainEqual(["D2", "C1", "reference", "-", "reference", false]);
  });

  it("[SR-111/AK1] a node the down walk places nearer than the up walk keeps the down walk's order", async () => {
    const workspace = await open(withD2ReferencingE1);
    // E1 is two steps up (S1 references D2, D2 references E1) and one step down: below S1, after C3.
    const output = await graph(workspace, { ref: ID.S1, maxDepth: 2 });
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 11));
  });

  it("[SR-111/AK1] lists every link between two nodes once, also those the walks did not take, by source in node order", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, allLevels: true });
    expect(edges(output)).toEqual([
      ["S1", "N1", "relation", "derives-from", "derivation", false],
      ["S1", "D1", "relation", "based-on", "-", false],
      ["S1", "PKG", "relation", "packages", "-", false],
      ["S1", "O1", "relation", "supersedes", "replacement", false],
      ["S1", "D2", "reference", "-", "reference", true],
      ["D1", "S1", "reference", "-", "reference", false],
      ["D2", "C1", "reference", "-", "reference", false],
      ["C1", "S1", "relation", "derives-from", "derivation", false],
      // Not taken by a walk: C1 is below S1, D1 above it.
      ["C1", "D1", "relation", "based-on", "-", false],
      ["C2", "S1", "relation", "derives-from", "derivation", true],
      ["C3", "S1", "relation", "derives-from", "derivation", false],
      ["C3", "C1", "relation", "derives-from", "derivation", false],
      ["E1", "S1", "reference", "-", "reference", false],
      // G1's reference to itself is no edge.
      ["G1", "C1", "relation", "derives-from", "derivation", false],
      ["GG1", "G1", "relation", "derives-from", "derivation", false],
    ]);
    expect(output.edges.find((e) => e.kind === "packages")).toMatchObject({ property: true });
    expect(
      output.edges.every((e) => e.sourceRepository === "system" && e.targetRepository === "system"),
    ).toBe(true);
  });

  it("[SR-111/AK2] maxDepth 1 gives the direct neighbours, 2 two levels, allLevels the whole chain", async () => {
    const workspace = await open();
    const one = await graph(workspace, { ref: ID.S1, maxDepth: 1 });
    expect(levels(one)).toEqual(ALL_LEVELS.slice(0, 10));
    // At maxDepth the links were not looked at.
    expect(expansion(one).filter(([, level]) => level !== 0)).toEqual(
      ALL_LEVELS.slice(1, 10).map(([name, level]) => [name, level, false]),
    );
    expect(one.nodes[0]?.expanded).toBe(true);
    expect(levels(await graph(workspace, { ref: ID.S1, maxDepth: 2 }))).toEqual(ALL_LEVELS.slice(0, 11));
    const all = await graph(workspace, { ref: ID.S1, allLevels: true });
    expect(levels(all)).toEqual(ALL_LEVELS);
    expect(all.nodes.every((n) => n.expanded)).toBe(true);
    expect(all.truncated).toBe(false);
    const none = await graph(workspace, { ref: ID.S1, maxDepth: 0 });
    expect([expansion(none), none.edges, none.truncated]).toEqual([[["S1", 0, false]], [], false]);
    const both = await failure(workspace, { ref: ID.S1, maxDepth: 2, allLevels: true });
    expect([both.code, both.message, both.details]).toEqual([
      "input.invalid",
      "give maxDepth or allLevels, not both",
      { command: "trace.graph", fields: ["maxDepth", "allLevels"] },
    ]);
  });

  it("[SR-111/AK2] limit keeps the nearest nodes; a node whose links lead to a node left out is not expanded", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, allLevels: true, limit: 8 });
    // Neither walk reaches 8 elements: the final cut leaves out C3, E1, G1 and GG1.
    expect(expansion(output)).toEqual([
      ["S1", 0, false],
      ["N1", -1, true],
      ["D1", -1, true],
      ["PKG", -1, true],
      ["O1", -1, true],
      ["D2", -1, true],
      ["C1", 1, false],
      ["C2", 1, true],
    ]);
    expect(output.truncated).toBe(true);
    // Only links between the nodes kept.
    expect(edges(output).map(([source, target]) => [source, target])).toEqual([
      ["S1", "N1"],
      ["S1", "D1"],
      ["S1", "PKG"],
      ["S1", "O1"],
      ["S1", "D2"],
      ["D1", "S1"],
      ["D2", "C1"],
      ["C1", "S1"],
      ["C1", "D1"],
      ["C2", "S1"],
    ]);
  });

  it("[SR-111/AK2] limit cuts a level in walk order, also for a node the up walk reached first", async () => {
    const workspace = await open(withD2ReferencingE1);
    const output = await graph(workspace, { ref: ID.S1, allLevels: true, limit: 8 });
    // E1 is one step down and comes last at +1, so the cut keeps C1 and C2, not E1.
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 8));
    expect(output.truncated).toBe(true);
  });

  it("[SR-111/AK2] limit stops each walk once it has reached that many elements", async () => {
    const workspace = await open();
    // Both walks reach five elements from S1, then stop: nothing beyond was looked at.
    const output = await graph(workspace, { ref: ID.S1, allLevels: true, limit: 3 });
    expect(expansion(output)).toEqual([
      ["S1", 0, false],
      ["N1", -1, false],
      ["D1", -1, false],
    ]);
    expect(output.truncated).toBe(true);
    const root = await graph(workspace, { ref: ID.S1, limit: 1 });
    expect([expansion(root), root.edges, root.truncated]).toEqual([[["S1", 0, false]], [], true]);
  });

  it("[SR-111/AK3] meanings and kinds keep only those links and the nodes they reach", async () => {
    const workspace = await open();
    const derivations = await graph(workspace, { ref: ID.S1, allLevels: true, meanings: ["derivation"] });
    expect(levels(derivations)).toEqual([
      ["S1", 0],
      ["N1", -1],
      ["C1", 1],
      ["C2", 1],
      ["C3", 1],
      ["G1", 2],
      ["GG1", 3],
    ]);
    expect(new Set(derivations.edges.map((e) => e.meaning))).toEqual(new Set(["derivation"]));
    const references = await graph(workspace, { ref: ID.S1, meanings: ["reference"] });
    expect(levels(references)).toEqual([
      ["S1", 0],
      ["D2", -1],
      ["D1", 1],
      ["E1", 1],
    ]);
    expect(edges(references).map(([source, target, link]) => [source, target, link])).toEqual([
      ["S1", "D2", "reference"],
      ["D1", "S1", "reference"],
      ["E1", "S1", "reference"],
    ]);
    const basedOn = await graph(workspace, { ref: ID.S1, repository: "system", kinds: ["based-on"] });
    expect([levels(basedOn), edges(basedOn)]).toEqual([
      [
        ["S1", 0],
        ["D1", -1],
      ],
      [["S1", "D1", "relation", "based-on", "-", false]],
    ]);
    const unknown = await failure(workspace, { ref: ID.S1, kinds: ["nope"] });
    expect([unknown.code, unknown.details?.["fields"]]).toEqual(["input.invalid", ["kinds"]]);
  });

  it("[SR-111/AK4] nodes carry title and type and marks only when outdated, superseded or without evidence", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, allLevels: true });
    expect(output.nodes.map((n) => [nameOf(n.id), n.type, n.title, n.marks])).toEqual([
      ["S1", "system-requirement", "Show wind speed", ["outdated"]],
      ["N1", "need", "See the wind", []],
      ["D1", "decision", "Use a cup anemometer", []],
      ["PKG", "package", "Stage 1", []],
      ["O1", "system-requirement", "Show wind in knots", ["superseded", "no-evidence"]],
      ["D2", "decision", "Use SI units", []],
      ["C1", "component-requirement", "Count anemometer turns", []],
      ["C2", "component-requirement", "Average over ten minutes", ["outdated", "no-evidence"]],
      ["C3", "component-requirement", "Convert turns to speed", ["no-evidence"]],
      ["E1", "decision", "Show values on the display", []],
      ["G1", "component-requirement", "Debounce the turn sensor", []],
      ["GG1", "component-requirement", "Heat the turn sensor", ["no-evidence"]],
    ]);
    expect(output.nodes.every((n) => n.shortId.length > 0 && n.file.endsWith(".md"))).toBe(true);
    expect(output.nodes.find((n) => n.id === ID.O1)?.status).toBe("obsolete");
  });

  it("[SR-111/AK4] marks are the same whatever depth or kinds are shown", async () => {
    const workspace = await open();
    // At depth 1 C1's child G1 is not shown, and C1 still has a child; only derivations are followed,
    // and S1 still stores an outdated reference.
    const one = await graph(workspace, { ref: ID.S1, maxDepth: 1, meanings: ["derivation"] });
    expect([marked(one, "outdated"), marked(one, "no-evidence")]).toEqual([
      ["S1", "C2"],
      ["C2", "C3"],
    ]);
    // A node that stores no versioned link.
    const need = await graph(workspace, { ref: ID.N1, maxDepth: 0 });
    expect(need.nodes.map((n) => [nameOf(n.id), n.marks])).toEqual([["N1", []]]);
  });

  it("[SR-111/AK4] a node is outdated exactly when element.get gives it a relation.outdated hint", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, allLevels: true });
    const hinted: string[] = [];
    for (const node of output.nodes) {
      const got = (await invoke(
        "element.get",
        { ref: node.id },
        { workspace },
      )) as CommandOutput<"element.get">;
      if ((got.element.problems ?? []).some((p) => p.code === "relation.outdated")) {
        hinted.push(nameOf(node.id));
      }
    }
    expect(marked(output, "outdated")).toEqual(hinted);
    expect(hinted).toEqual(["S1", "C2"]);
  });

  it("[SR-111/AK4] no-evidence is the chain's gap rule, also in a view", async () => {
    const workspace = await open();
    for (const view of [undefined, "core", ID.V1]) {
      const input = { ref: ID.S1, ...(view === undefined ? {} : { view }) };
      const output = await graph(workspace, { ...input, allLevels: true });
      const chain = (await invoke("trace.chain", input, { workspace })) as CommandOutput<"trace.chain">;
      const expanded = new Set(
        chain.nodes.filter((n) => n.expanded && n.direction !== "up").map((n) => n.id),
      );
      const gaps = chain.gaps.filter((g) => g.kind === "no-evidence").map((g) => nameOf(g.id));
      expect(marked(output, "no-evidence").filter((name) => expanded.has(ID[name as Name]))).toEqual(gaps);
    }
    // In the core GG1 does not apply: G1 has no child there.
    const core = await graph(workspace, { ref: ID.S1, allLevels: true, view: "core" });
    expect([levels(core).map(([name]) => name), marked(core, "no-evidence")]).toEqual([
      ["S1", "N1", "D1", "PKG", "O1", "D2", "C1", "C2", "C3", "E1", "G1"],
      ["O1", "C2", "C3", "G1"],
    ]);
  });

  it("gives a hint and no no-evidence mark without a relation kind with the meaning derivation (SR-013 AK3)", async () => {
    const workspace = await open(async (fixture) => {
      const file = fixture.path("metamodel/standard-model.yaml");
      const { readFile } = await import("node:fs/promises");
      await fixture.write(
        "metamodel/standard-model.yaml",
        (await readFile(file, "utf8")).replaceAll("    meaning: derivation\n", ""),
      );
    });
    const output = await graph(workspace, { ref: ID.S1 });
    expect(output.problems.map((p) => [p.code, p.severity, p.message])).toEqual([
      [
        "metamodel.meaning-unassigned",
        "warning",
        "No relation kind of the metamodel has the meaning derivation, which trace.graph needs. Add `meaning: derivation` to a relation kind in the metamodel files.",
      ],
    ]);
    expect(marked(output, "no-evidence")).toEqual([]);
    expect(marked(output, "superseded")).toEqual(["O1"]);
  });

  it("gives no hint while the metamodel is not valid", async () => {
    const workspace = await open(async (fixture) => {
      await fixture.write("metamodel/broken.yaml", "logreq-metamodel: 1\ntypes: 5\n");
    });
    const output = await graph(workspace, { ref: ID.S1 });
    expect(output.problems).toEqual([]);
  });

  it("refuses an unknown element and a view that is no variant", async () => {
    const workspace = await open();
    expect((await failure(workspace, { ref: "SR-ffffff" })).code).toBe("ref.unknown");
    expect((await failure(workspace, { ref: ID.S1, view: ID.N1 })).code).toBe("input.invalid");
  });
});
