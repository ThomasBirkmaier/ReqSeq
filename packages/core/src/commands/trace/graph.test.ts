// trace.graph through `invoke` (SR-111, D-063) on fixtures/SR-111/graph: the data of AK1 to AK4, the
// truncation contract and the marks against element.get; the verification of the nodes (SR-136) on
// fixtures/SR-136/graph against element.get and evidence.degree. S1 is the element: it
// derives from N1, is based on D1, is in PKG, supersedes O1 (obsolete) and references D2 with an
// outdated version. C1, C2 and C3 derive from S1 (C2's version is outdated), C3 also from C1, G1 from
// C1, GG1 from G1 (valid only in the variant V1). D1 references S1 (so it is above and below S1), D2
// references C1 (a link from a parent to a child), E1 references S1, C1 is based on D1 (a link the
// walks do not take) and G1 references itself.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
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

/** fixtures/SR-136/graph with a variant f001 and a requirement b099 valid only in it, deriving from a001. */
const IN_VARIANT_ONLY: Readonly<Record<string, string>> = {
  "variants/VAR-00000000f001.md":
    "---\nid: 37373737-3737-4737-8737-00000000f001\ntype: variant\nstatus: draft\ntitle: Coast\n---\n",
  "requirements/SR-00000000b099.md":
    "---\nid: 37373737-3737-4737-8737-00000000b099\ntype: system-requirement\nstatus: draft\n" +
    "title: Show the tide\nrequirement-type: functional\nacceptance-criteria:\n  - Given the tide, then it shows.\n" +
    "validity:\n  - { id: 37373737-3737-4737-8737-00000000f001, version: n1:0000000000000000 }\n" +
    "derives-from:\n  - { id: 37373737-3737-4737-8737-00000000a001, version: n1:0000000000000000 }\n---\n",
};

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
  await fixture.write(file, `${text}See also [the display](reqseq:${ID.E1}).\n`);
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
  it("[SR-111/AK-g4rk] the element is the one node at level 0, what it links to at negative levels, what links to it at positive levels", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1 });
    expect(output.root).toBe(ID.S1);
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 10));
    // D1 is reached both ways (S1 is based on it, its text references S1): one node, above on a tie.
    expect(output.nodes.filter((n) => n.id === ID.D1)).toHaveLength(1);
    expect(output.nodes.filter((n) => n.level === 0).map((n) => nameOf(n.id))).toEqual(["S1"]);
    expect([output.truncated, output.incomplete, output.problems]).toEqual([false, false, []]);
  });

  it("[SR-111/AK-g4rk] places an element at its smaller distance, and a link against the levels stays an edge", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, maxDepth: 2 });
    // C1 is two steps up (S1 references D2, D2 references C1) and one step down: below S1.
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 11));
    expect(edges(output)).toContainEqual(["D2", "C1", "reference", "-", "reference", false]);
  });

  it("[SR-111/AK-g4rk] a node the down walk places nearer than the up walk keeps the down walk's order", async () => {
    const workspace = await open(withD2ReferencingE1);
    // E1 is two steps up (S1 references D2, D2 references E1) and one step down: below S1, after C3.
    const output = await graph(workspace, { ref: ID.S1, maxDepth: 2 });
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 11));
  });

  it("[SR-111/AK-g4rk] lists every link between two nodes once, also those the walks did not take, by source in node order", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, allLevels: true });
    expect(edges(output)).toEqual([
      ["S1", "N1", "relation", "derives-from", "derivation", false],
      ["S1", "D1", "relation", "based-on", "-", false],
      ["S1", "PKG", "relation", "packages", "-", false],
      ["S1", "O1", "relation", "supersedes", "succession", false],
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

  it("[SR-111/AK-p2tx] maxDepth 1 gives the direct neighbours, 2 two levels, allLevels the whole chain", async () => {
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

  it("[SR-111/AK-p2tx] limit keeps the nearest nodes; a node whose links lead to a node left out is not expanded", async () => {
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

  it("[SR-111/AK-p2tx] limit cuts a level in walk order, also for a node the up walk reached first", async () => {
    const workspace = await open(withD2ReferencingE1);
    const output = await graph(workspace, { ref: ID.S1, allLevels: true, limit: 8 });
    // E1 is one step down and comes last at +1, so the cut keeps C1 and C2, not E1.
    expect(levels(output)).toEqual(ALL_LEVELS.slice(0, 8));
    expect(output.truncated).toBe(true);
  });

  it("[SR-111/AK-p2tx] limit stops each walk once it has reached that many elements", async () => {
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

  it("[SR-111/AK-h6n9] meanings and kinds keep only those links and the nodes they reach", async () => {
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

  it("[SR-111/AK-kq3w] nodes carry title and type and marks only when outdated or superseded", async () => {
    const workspace = await open();
    const output = await graph(workspace, { ref: ID.S1, allLevels: true });
    expect(output.nodes.map((n) => [nameOf(n.id), n.type, n.title, n.marks])).toEqual([
      ["S1", "system-requirement", "Show wind speed", ["outdated"]],
      ["N1", "need", "See the wind", []],
      ["D1", "decision", "Use a cup anemometer", []],
      ["PKG", "package", "Stage 1", []],
      ["O1", "system-requirement", "Show wind in knots", ["superseded"]],
      ["D2", "decision", "Use SI units", []],
      ["C1", "component-requirement", "Count anemometer turns", []],
      ["C2", "component-requirement", "Average over ten minutes", ["outdated"]],
      ["C3", "component-requirement", "Convert turns to speed", []],
      ["E1", "decision", "Show values on the display", []],
      ["G1", "component-requirement", "Debounce the turn sensor", []],
      ["GG1", "component-requirement", "Heat the turn sensor", []],
    ]);
    expect(output.nodes.every((n) => n.shortId.length > 0 && n.file.endsWith(".md"))).toBe(true);
    expect(output.nodes.find((n) => n.id === ID.O1)?.status).toBe("obsolete");
  });

  it("[SR-111/AK-kq3w] marks are the same whatever depth or kinds are shown", async () => {
    const workspace = await open();
    // Only derivations are followed, and S1 still stores an outdated reference.
    const one = await graph(workspace, { ref: ID.S1, maxDepth: 1, meanings: ["derivation"] });
    expect(marked(one, "outdated")).toEqual(["S1", "C2"]);
    // A node that stores no versioned link.
    const need = await graph(workspace, { ref: ID.N1, maxDepth: 0 });
    expect(need.nodes.map((n) => [nameOf(n.id), n.marks])).toEqual([["N1", []]]);
  });

  it("[SR-111/AK-kq3w] a node is outdated exactly when element.get gives it a relation.outdated hint", async () => {
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

  it("[SR-111/AK-h6n9] withEvidence gives the evidence trace.chain lists in the same view, also with a test case of C3", async () => {
    const workspace = await open(async (fixture) => {
      await fixture.write(
        "evidence/ci/run-c3.xml",
        [
          '<testsuites><testsuite name="station" tests="1">',
          '<testcase classname="t" name="turns"><properties>',
          `<property name="reqseq:element" value="${ID.C3}"/>`,
          '<property name="reqseq:version" value="n1:0000000000000000"/>',
          '<property name="reqseq:item" value="build-1"/>',
          '<property name="reqseq:date" value="2026-10-21T09:00:00Z"/>',
          "</properties></testcase></testsuite></testsuites>",
          "",
        ].join("\n"),
      );
    });
    for (const view of [undefined, "core", ID.V1]) {
      const shown = await graph(workspace, {
        ref: ID.S1,
        allLevels: true,
        withEvidence: true,
        ...(view === undefined ? {} : { view }),
      });
      // The evidence is the chain's in the same view (the core without one).
      const viewed = (await invoke(
        "trace.chain",
        { ref: ID.S1, view: view ?? "core" },
        { workspace },
      )) as CommandOutput<"trace.chain">;
      expect((shown.evidence ?? []).map((e) => [nameOf(e.id), e.level, e.testCases, e.records])).toEqual(
        viewed.evidence.map((e) => [nameOf(e.id), e.depth, e.testCases.length, e.records.length]),
      );
    }
  });

  it("[SR-111/AK-h6n9] withEvidence gives a summary of the evidence below each node, in the view", async () => {
    const workspace = await open();
    const summaries = async (input: Record<string, unknown>): Promise<unknown[]> =>
      ((await graph(workspace, { ...input, withEvidence: true })).evidence ?? []).map((e) => [
        nameOf(e.id),
        e.repository,
        e.level,
        e.testCases,
        e.records,
        e.results,
      ]);
    // S1: two JUnit test cases (one failed) and an inspection; C1: a skipped test case, and in the
    // variant V1 a demonstration.
    expect(await summaries({ ref: ID.S1, allLevels: true })).toEqual([
      ["S1", "system", 1, 2, 1, { passed: 2, failed: 1 }],
      ["C1", "system", 2, 1, 0, { skipped: 1 }],
    ]);
    // In V1 the records without a variant do not hold (S1); the demonstration for V1 does, and the
    // skipped test case shows in every view (C1).
    expect(await summaries({ ref: ID.S1, allLevels: true, view: ID.V1 })).toEqual([
      ["C1", "system", 2, 1, 1, { passed: 1, skipped: 1 }],
    ]);
    // Within the depth asked: the direct neighbours give the element's evidence only, depth 0 none.
    expect(await summaries({ ref: ID.S1 })).toEqual([["S1", "system", 1, 2, 1, { passed: 2, failed: 1 }]]);
    expect(await summaries({ ref: ID.S1, maxDepth: 0 })).toEqual([]);
    // None above the element: S1 is C1's parent.
    expect(await summaries({ ref: ID.C1 })).toEqual([["C1", "system", 1, 1, 0, { skipped: 1 }]]);
    // A node that `limit` left unexpanded keeps its evidence, and the evidence is no node.
    const cut = await graph(workspace, { ref: ID.S1, allLevels: true, limit: 7, withEvidence: true });
    expect([cut.nodes.length, cut.nodes.find((n) => n.id === ID.C1)?.expanded]).toEqual([7, false]);
    expect(cut.evidence?.map((e) => nameOf(e.id))).toEqual(["S1", "C1"]);
    // Without withEvidence, no evidence.
    expect("evidence" in (await graph(workspace, { ref: ID.S1 }))).toBe(false);
  });

  it("[SR-111/AK-kq3w] is incomplete, as trace.chain, while an evidence location is not on this machine", async () => {
    const workspace = await open(async (fixture) => {
      const { readFile } = await import("node:fs/promises");
      const config = await readFile(fixture.path("reqseq-workspace.yaml"), "utf8");
      await fixture.write(
        "reqseq-workspace.yaml",
        config.replace(
          "repositories:\n",
          'repositories:\n  - { name: tests, url: "git@git.example.com:ws/tests.git" }\n',
        ) + "  - { repository: tests, path: evidence }\n",
      );
    });
    const output = await graph(workspace, { ref: ID.S1 });
    const chain = (await invoke(
      "trace.chain",
      { ref: ID.S1 },
      { workspace },
    )) as CommandOutput<"trace.chain">;
    expect([output.incomplete, chain.incomplete]).toEqual([true, true]);
  });

  it("[SR-111/AK-h6n9] withEvidence is incomplete while an evidence location is not on this machine, also without derivations", async () => {
    const workspace = await open(async (fixture) => {
      const { readFile } = await import("node:fs/promises");
      const model = await readFile(fixture.path("metamodel/standard-model.yaml"), "utf8");
      await fixture.write("metamodel/standard-model.yaml", model.replaceAll("    meaning: derivation\n", ""));
      const config = await readFile(fixture.path("reqseq-workspace.yaml"), "utf8");
      await fixture.write(
        "reqseq-workspace.yaml",
        config.replace(
          "repositories:\n",
          'repositories:\n  - { name: tests, url: "git@git.example.com:ws/tests.git" }\n',
        ) + "  - { repository: tests, path: evidence }\n",
      );
    });
    // Depth 0 takes no step into the missing repository; the evidence read, which the status reads too, is
    // incomplete.
    const plain = await graph(workspace, { ref: ID.S1, maxDepth: 0 });
    const shown = await graph(workspace, { ref: ID.S1, maxDepth: 0, withEvidence: true });
    expect([plain.incomplete, shown.incomplete, shown.evidence]).toEqual([true, true, []]);
  });

  it("gives a hint and a need no derived requirement without a relation kind with the meaning derivation (SR-013 AK3)", async () => {
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
    expect(output.nodes.find((n) => n.id === ID.N1)?.degree).toEqual({
      total: 0,
      counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 },
    });
    expect(marked(output, "superseded")).toEqual(["O1"]);
  });

  it("gives no hint while the metamodel is not valid", async () => {
    const workspace = await open(async (fixture) => {
      await fixture.write("metamodel/broken.yaml", "reqseq-metamodel: 1\ntypes: 5\n");
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

describe("trace.graph: the verification of the nodes (SR-136)", () => {
  const U = (tail: string): string => `37373737-3737-4737-8737-00000000${tail}`;
  const openGraph = async (): Promise<Workspace> => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-136/graph" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    return workspace;
  };
  type Node = Output["nodes"][number];
  const nodeOf = async (
    workspace: Workspace,
    ref: string,
    more: Record<string, unknown> = {},
  ): Promise<Node> => {
    const output = await graph(workspace, { ref, maxDepth: 0, ...more });
    const [node] = output.nodes;
    if (node === undefined) {
      throw new Error(`no node for ${ref}`);
    }
    return node;
  };
  const counts = (open: number, verified: number, indirect: number, failed: number, outdated: number) => ({
    open,
    verified,
    indirect,
    failed,
    outdated,
  });

  it("[SR-136/AK-h2xg] each requirement node carries its status in the view as element.get gives it, other nodes none", async () => {
    const workspace = await openGraph();
    const output = await graph(workspace, { ref: U("a001"), allLevels: true });
    const requirements = output.nodes.filter((n) => n.type === "system-requirement");
    expect(requirements.length).toBeGreaterThan(10);
    for (const node of output.nodes) {
      const got = (await invoke(
        "element.get",
        { ref: node.id },
        { workspace },
      )) as CommandOutput<"element.get">;
      expect([node.shortId, node.verification]).toEqual([
        node.shortId,
        got.element.verification?.filter((entry) => entry.view === "core"),
      ]);
    }
    expect(requirements.map((n) => n.verification?.[0]?.status).sort()).toContain("failed");
    // In a graph without view, a requirement that applies only in a variant has no status (#1111), in the
    // variant's view it has one.
    const station = await open();
    const core = await graph(station, { ref: ID.S1, allLevels: true });
    expect(core.nodes.find((n) => n.id === ID.GG1)?.verification).toBeUndefined();
    const inV1 = await graph(station, { ref: ID.S1, allLevels: true, view: ID.V1 });
    expect(inV1.nodes.find((n) => n.id === ID.GG1)?.verification?.[0]?.view).toBe(ID.V1);
  });

  it("[SR-136/AK-dfzw] without a variant each requirement node shows its status in the core, one not in the core's view none and no ring; with one, in its view", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-136/graph", files: IN_VARIANT_ONLY });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const [b001, b099, coast] = [U("b001"), U("b099"), U("f001")];
    const nodeIn = (output: Output, id: string): Node | undefined => output.nodes.find((n) => n.id === id);
    const core = await graph(workspace, { ref: U("a001") });
    expect([nodeIn(core, b001)?.verification?.map((v) => v.view), nodeIn(core, b001)?.criteria]).toEqual([
      ["core"],
      { verified: 1, total: 1 },
    ]);
    expect([nodeIn(core, b099)?.verification, nodeIn(core, b099)?.criteria]).toEqual([undefined, undefined]);
    const inCoast = await graph(workspace, { ref: U("a001"), view: coast });
    expect(nodeIn(inCoast, b001)?.verification?.map((v) => v.view)).toEqual([coast]);
    expect([nodeIn(inCoast, b099)?.verification, nodeIn(inCoast, b099)?.criteria]).toEqual([
      [{ view: coast, status: "open" }],
      { verified: 0, total: 1, notVerified: [{ criterion: 1, text: expect.any(String) as string }] },
    ]);
  });

  it("[SR-136/AK-kvvw] a requirement with acceptance criteria counts its verified ones, 2 of 3, and 0 of n without a record", async () => {
    const workspace = await openGraph();
    const r11 = await nodeOf(workspace, U("b011"));
    expect([r11.verification?.[0]?.status, r11.criteria]).toEqual([
      "open",
      { verified: 2, total: 3, notVerified: [{ criterion: 3, text: expect.any(String) as string }] },
    ]);
    const r09 = await nodeOf(workspace, U("b009"));
    expect([r09.verification?.[0]?.status, r09.criteria]).toEqual([
      "open",
      { verified: 0, total: 1, notVerified: [{ criterion: 1, text: expect.any(String) as string }] },
    ]);
    expect((await nodeOf(workspace, U("b001"))).criteria).toEqual({ verified: 1, total: 1 });
  });

  it("[SR-136/AK-thr6] a need with 10 derived requirements shows 60 %, the same at every depth and choice of kinds", async () => {
    const workspace = await openGraph();
    const expected = { share: 0.6, total: 10, counts: counts(2, 6, 0, 1, 1) };
    for (const input of [
      { maxDepth: 0 },
      { maxDepth: 1 },
      { allLevels: true },
      { meanings: [] },
      { kinds: ["packages"] },
    ]) {
      const output = await graph(workspace, { ref: U("a001"), ...input });
      expect([input, output.nodes[0]?.degree]).toEqual([input, expected]);
    }
    // As evidence.degree gives it for the selection of these ten (the package P1 of SR-037).
    const p1 = (await invoke(
      "evidence.degree",
      { selection: { package: "PKG-00d001" } },
      { workspace },
    )) as CommandOutput<"evidence.degree">;
    expect(p1.degree).toEqual(expected);
    // Shown from a requirement, the need above it has the same degree.
    const fromR01 = await graph(workspace, { ref: U("b001") });
    expect(fromR01.nodes.find((n) => n.id === U("a001"))?.degree).toEqual(expected);
  });

  it("[SR-136/AK-w6gh] an indirectly verified requirement carries its status and no criteria", async () => {
    const workspace = await openGraph();
    const i1 = await nodeOf(workspace, U("b101"));
    expect([i1.verification?.[0]?.status, i1.criteria]).toEqual(["indirect", undefined]);
  });

  it("[SR-136/AK-qgyd] a requirement without acceptance criteria carries its status and no criteria", async () => {
    const workspace = await openGraph();
    const r12 = await nodeOf(workspace, U("b012"));
    expect([r12.verification?.[0]?.status, r12.criteria]).toEqual(["verified", undefined]);
  });

  it("[SR-136/AK-t58p] a need from which no valid requirement derives has a degree without share", async () => {
    const workspace = await openGraph();
    const n2 = await nodeOf(workspace, U("a002"));
    expect(n2.degree).toEqual({ total: 0, counts: counts(0, 0, 0, 0, 0) });
    expect(n2.verification).toBeUndefined();
  });
});
