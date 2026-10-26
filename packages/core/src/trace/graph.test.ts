import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState, incomingState, relationPath } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { DerivationLink } from "./graph.js";
import {
  childrenOf,
  derivationEdges,
  derivationGraph,
  parentPositions,
  parentsOf,
  traceContext,
  walkDerivation,
} from "./graph.js";
import { cyclesOf } from "./walk.js";
import type { Expansion } from "./walk.js";

const V = "n1:1111111111111111";
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const N1 = uuid(1);
const N2 = uuid(2);
const S1 = uuid(3);
const S2 = uuid(4);
const P1 = uuid(5);
const P2 = uuid(6);
const DUP = uuid(7);
const MISSING = uuid(8);
const A1 = uuid(9);
const U1 = uuid(10);

const workspaceFile = (repositories: readonly string[]): string =>
  [
    "logreq-workspace: 1",
    "name: Trace",
    "repositories:",
    "  - { name: system, url: git@example.com:system.git, main: true }",
    ...repositories,
    "metamodel: { repository: system, path: metamodel }",
    "",
  ].join("\n");

const PLATFORM = "  - { name: platform, url: git@example.com:platform.git, path: ../platform }";
/** Listed in the workspace file, not on this machine. */
const AWAY = "  - { name: away, url: git@example.com:away.git, path: ../away }";

const element = (id: string, type: string, frontmatter: readonly string[] = [], text = ""): string =>
  ["---", `id: ${id}`, `type: ${type}`, "status: draft", "title: T", ...frontmatter, "---", text].join("\n");

const FILES = {
  "system/logreq-workspace.yaml": workspaceFile([PLATFORM, AWAY]),
  "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  "system/needs/N-000000000001.md": element(N1, "need"),
  "system/needs/N-000000000002.md": element(N2, "need"),
  // Two files with one UUID (SR-088).
  "system/needs/N-000000000007.md": element(DUP, "need"),
  "system/needs/copy/N-000000000007.md": element(DUP, "need"),
  "system/requirements/SR-000000000003.md": element(
    S1,
    "system-requirement",
    [
      `derives-from:\n  - { id: ${N1}, version: ${V}, title: T }`,
      `refines:\n  - { id: ${N2}, version: ${V}, title: T }`,
      // A replacement is no derivation, and neither is an inline reference (ADR-0004).
      `supersedes:\n  - { id: ${N2}, version: ${V}, title: T }`,
    ],
    `See [the need](logreq:${N1}?version=${V}).\n`,
  ),
  "system/requirements/SR-000000000004.md": element(S2, "system-requirement", [
    "derives-from:",
    `  - { id: ${S1}, version: ${V}, title: T }`,
    `  - { id: ${P1}, version: ${V}, repository: platform }`,
    `  - { id: ${A1}, version: ${V}, repository: away }`,
    `  - { id: ${U1}, version: ${V}, repository: nowhere }`,
    `  - { id: ${MISSING}, version: ${V} }`,
    `  - { id: ${DUP}, version: ${V} }`,
    "  - just text",
  ]),
  "platform/needs/N-000000000005.md": element(P1, "need"),
  // The UUID of N1 in another repository too: each copy is the one record of it in its repository.
  "platform/needs/N-000000000001.md": element(N1, "need"),
  // A child in another repository than its parent.
  "platform/requirements/SR-000000000006.md": element(P2, "system-requirement", [
    `derives-from:\n  - { id: ${S1}, version: ${V}, repository: system }`,
  ]),
};

const open = async (files: Readonly<Record<string, string>> = FILES): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const recordsOf = async (workspace: Workspace): Promise<(id: string) => ElementRecord> => {
  const store = await workspace.get(elementStoreState);
  return (id) => {
    const [found] = store.byId.get(id) ?? [];
    if (found === undefined) {
      throw new Error(`no element ${id}`);
    }
    return found;
  };
};

/** Steps as `[to, child, kind, path]`, unresolved as `[target, state kind]`. */
const show = (
  expansion: Expansion<DerivationLink>,
): { readonly steps: unknown[]; readonly unresolved: unknown[]; readonly incomplete: boolean } => ({
  steps: expansion.steps.map((s) => [s.to.id, s.link.source.id, s.link.key, relationPath(s.link)]),
  unresolved: expansion.unresolved.map((u) => [u.link.item.id, u.state.kind]),
  incomplete: expansion.incomplete,
});

// `derivationGraph` names the command in its error (SR-013 AK3); the tests name `trace.chain`.
describe("derivation graph (D-012, SR-013, ADR-0004)", () => {
  it("reads the states once, with the incoming index of the store", async () => {
    const workspace = await open();
    const context = await traceContext(workspace);
    expect(context.store).toBe(await workspace.get(elementStoreState));
    expect(workspace.peek(incomingState)?.get(context.store)).toBe(context.incoming);
    expect(context.layout.repositories.map((r) => [r.name, r.available])).toEqual([
      ["system", true],
      ["platform", true],
      ["away", false],
    ]);
  });

  it("follows the relation kinds with the meaning derivation, in metamodel order", async () => {
    const workspace = await open();
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    expect(graph.kinds.map((k) => k.key)).toEqual(["refines", "derives-from"]);
    // A property of the same key wins over a relation kind (`keyDefinition`): that key is no derivation.
    const shadowed: Metamodel = {
      ...graph.metamodel,
      properties: [...graph.metamodel.properties, { key: "refines", name: "Refines note", kind: "text" }],
    };
    const other = derivationGraph({ ...graph, metamodel: shadowed }, "trace.chain");
    expect(other.kinds.map((k) => k.key)).toEqual(["derives-from"]);
  });

  it("names the missing assignment when no relation kind has the meaning derivation (SR-013 AK3)", async () => {
    const workspace = await open({
      ...FILES,
      "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT.replaceAll("    meaning: derivation\n", ""),
    });
    const context = await traceContext(workspace);
    expect(() => derivationGraph(context, "trace.chain")).toThrow(CommandError);
    try {
      derivationGraph(context, "trace.chain");
    } catch (error) {
      expect(error).toMatchObject({
        code: "metamodel.meaning-unassigned",
        details: { meaning: "derivation", list: "relations", command: "trace.chain" },
      });
    }
  });

  it("gives the parents of an element from its own relations (source = child, target = parent)", async () => {
    const workspace = await open();
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    // Metamodel order of the kinds; a replacement and an inline reference are no parents.
    expect(show(parentsOf(graph, r(S1)))).toEqual({
      steps: [
        [N2, S1, "refines", ["refines", 0]],
        [N1, S1, "derives-from", ["derives-from", 0]],
      ],
      unresolved: [],
      incomplete: false,
    });
    // Targets that cannot be followed: only a repository that is not here or not listed makes it incomplete.
    expect(show(parentsOf(graph, r(S2)))).toEqual({
      steps: [
        [S1, S2, "derives-from", ["derives-from", 0]],
        [P1, S2, "derives-from", ["derives-from", 1]],
      ],
      unresolved: [
        [A1, "inaccessible"],
        [U1, "unknown-repository"],
        [MISSING, "missing"],
        [DUP, "ambiguous"],
      ],
      incomplete: true,
    });
    const missingOnly = parentsOf(graph, {
      ...r(S2),
      data: { ...r(S2).data, "derives-from": [{ id: MISSING, version: V }] },
    });
    expect(show(missingOnly)).toEqual({ steps: [], unresolved: [[MISSING, "missing"]], incomplete: false });
    expect(show(parentsOf(graph, r(N1)))).toEqual({ steps: [], unresolved: [], incomplete: false });
  });

  it("gives the store positions of the parents parentsOf steps to, without the incoming index (SR-075)", async () => {
    const workspace = await open();
    const store = await workspace.get(elementStoreState);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    const odd = (base: ElementRecord): ElementRecord => ({
      ...base,
      id: uuid(99),
      // `repository: null` names no repository; a single target where a list belongs is none.
      data: { "derives-from": [{ id: N1, repository: null }, { id: S1 }], refines: { id: N2 } },
    });
    const [first = store.elements[0]] = store.elements;
    const elements = [...store.elements, ...(first === undefined ? [] : [odd(first)])];
    const positions = parentPositions({ kinds: graph.kinds, store: { ...store, elements } });
    expect(positions.map((entry) => entry.element)).toEqual(elements);
    for (const { element, parents } of positions) {
      expect(parents.map((position) => elements[position])).toEqual(
        parentsOf(graph, element).steps.map((step) => step.to),
      );
    }
    const r = await recordsOf(workspace);
    const s2 = positions.find((entry) => entry.element === r(S2))?.parents ?? [];
    expect(s2.map((position) => [elements[position]?.id, elements[position]?.repository])).toEqual([
      [S1, "system"],
      [P1, "platform"],
    ]);
    expect(positions.at(-1)?.parents.map((position) => elements[position]?.id)).toEqual([S1]);
  });

  it("gives the children of an element from the incoming index, across repositories", async () => {
    const workspace = await open();
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    // Repository `away` is not on this machine: children there cannot be seen (spec question #262).
    expect(show(childrenOf(graph, r(S1)))).toEqual({
      steps: [
        [S2, S2, "derives-from", ["derives-from", 0]],
        [P2, P2, "derives-from", ["derives-from", 0]],
      ],
      unresolved: [],
      incomplete: true,
    });
    // The inline reference of S1 to N1 is no child relation; nor is the replacement of N2.
    expect(show(childrenOf(graph, r(N1))).steps).toEqual([[S1, S1, "derives-from", ["derives-from", 0]]]);
    expect(show(childrenOf(graph, r(N2))).steps).toEqual([[S1, S1, "refines", ["refines", 0]]]);
    expect(show(childrenOf(graph, r(P1))).steps).toEqual([[S2, S2, "derives-from", ["derives-from", 1]]]);
    // An element whose UUID several files share: its children are unresolved as ambiguous, as the
    // way up from them is (SR-088), naming both files.
    const store = await workspace.get(elementStoreState);
    const dups = store.byId.get(DUP) ?? [];
    expect(dups).toHaveLength(2);
    for (const dup of dups) {
      const children = childrenOf(graph, dup);
      expect(show(children)).toEqual({ steps: [], unresolved: [[DUP, "ambiguous"]], incomplete: true });
      expect(children.unresolved[0]).toEqual({
        link: {
          kind: "relation",
          source: r(S2),
          key: "derives-from",
          index: 5,
          item: { id: DUP, version: V },
          repository: "system",
        },
        state: { kind: "ambiguous", repository: "system", elements: dups },
      });
    }
    // The copy of N1's UUID in repository platform has none: S1 points into its own repository.
    const copy = (await workspace.get(elementStoreState)).byId
      .get(N1)
      ?.find((e) => e.repository === "platform");
    expect(copy && show(childrenOf(graph, copy)).steps).toEqual([]);
    // An element is named by repository and UUID: a record the store does not hold gets the relations that name it.
    expect(show(childrenOf(graph, { ...r(N1), id: MISSING })).steps).toEqual([
      [S2, S2, "derives-from", ["derives-from", 4]],
    ]);
  });

  it("gives every derivation edge of the store, from child to parent, with an available parent (SR-090)", async () => {
    const workspace = await open();
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    const edges = derivationEdges(graph);
    // Not: the replacement (no derivation), targets in a repository not here or not listed, a
    // missing target, one whose UUID two files share (as `targetState` finds them).
    expect(
      edges.map((e) => [e.from.id, e.to.id, e.to.repository, e.link.key, relationPath(e.link)]).sort(),
    ).toEqual(
      [
        [P2, S1, "system", "derives-from", ["derives-from", 0]],
        [S1, N1, "system", "derives-from", ["derives-from", 0]],
        [S1, N2, "system", "refines", ["refines", 0]],
        [S2, P1, "platform", "derives-from", ["derives-from", 1]],
        [S2, S1, "system", "derives-from", ["derives-from", 0]],
      ].sort(),
    );
    expect(edges.every((e) => e.link.source === e.from)).toBe(true);
    expect(edges.find((e) => e.from === r(P2))?.to).toBe(r(S1));
    expect(cyclesOf(graph.store.elements, edges)).toEqual([]);
  });

  it("is complete downwards when every repository of the workspace file is on this machine", async () => {
    const workspace = await open({ ...FILES, "system/logreq-workspace.yaml": workspaceFile([PLATFORM]) });
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    expect(childrenOf(graph, r(S1)).incomplete).toBe(false);
    expect(childrenOf(graph, r(DUP)).incomplete).toBe(false);
  });

  it("walks up to the top parents and down to the last children", async () => {
    const workspace = await open();
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    const up = walkDerivation(graph, [r(S2)], { direction: "up" });
    expect(up.nodes.map((n) => [n.element.id, n.depth])).toEqual([
      [S2, 0],
      [S1, 1],
      [P1, 1],
      [N2, 2],
      [N1, 2],
    ]);
    expect(up.incomplete).toBe(true);
    expect(up.unresolved.map((u) => [u.from.id, u.state.kind])).toEqual([
      [S2, "inaccessible"],
      [S2, "unknown-repository"],
      [S2, "missing"],
      [S2, "ambiguous"],
    ]);
    const down = walkDerivation(graph, [r(N1), r(N2)], { direction: "down", leaves: (e) => [e.id] });
    expect(down.nodes.map((n) => [n.element.id, n.depth, n.leaves])).toEqual([
      [N1, 0, [N1]],
      [N2, 0, [N2]],
      [S1, 1, [S1]],
      [S2, 2, [S2]],
      [P2, 2, [P2]],
    ]);
    // S1 derives from N1 and refines N2: two edges, one node.
    expect(down.edges.map((e) => [e.from.id, e.to.id, e.link.key])).toEqual([
      [N1, S1, "derives-from"],
      [N2, S1, "refines"],
      [S1, S2, "derives-from"],
      [S1, P2, "derives-from"],
    ]);
    expect(down.incomplete).toBe(true);
    expect(walkDerivation(graph, [r(N1)], { direction: "down", maxDepth: 1 }).nodes).toHaveLength(2);
  });

  it("stops at a cycle in the derivations and names it", async () => {
    const workspace = await open({
      "system/logreq-workspace.yaml": workspaceFile([]),
      "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
      // A derives from B, B from C and C from A.
      "system/requirements/SR-000000000001.md": element(N1, "system-requirement", [
        `derives-from:\n  - { id: ${N2}, version: ${V}, title: T }`,
      ]),
      "system/requirements/SR-000000000002.md": element(N2, "system-requirement", [
        `derives-from:\n  - { id: ${S1}, version: ${V}, title: T }`,
      ]),
      "system/requirements/SR-000000000003.md": element(S1, "system-requirement", [
        `refines:\n  - { id: ${N1}, version: ${V}, title: T }`,
      ]),
    });
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    for (const direction of ["up", "down"] as const) {
      const result = walkDerivation(graph, [r(N1)], { direction });
      expect(result.nodes).toHaveLength(3);
      expect(result.cycles.map((c) => c.elements.map((e) => e.id).sort())).toEqual([[N1, N2, S1]]);
      expect(result.edges.every((e) => e.cyclic)).toBe(true);
      expect(result.incomplete).toBe(false);
    }
    // The same cycle among all derivation edges of the store (SR-090).
    const all = cyclesOf(graph.store.elements, derivationEdges(graph));
    expect(all.map((c) => [c.elements.map((e) => e.id).sort(), c.edges.length])).toEqual([[[N1, N2, S1], 3]]);
  });

  it("follows a relation kind of the metamodel's own with the meaning derivation, and no other (SR-013 AK1)", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-013/own-meanings",
      files: {
        "wishes/W-000000000001.md": [
          "---",
          `id: ${N1}`,
          "type: wish",
          "status: open",
          "label: Wind",
          "---",
          "",
        ].join("\n"),
        "items/SPI-000000000002.md": [
          "---",
          `id: ${S1}`,
          "type: spec-item",
          "status: open",
          "label: Show wind",
          `satisfies:\n  - { id: ${N1}, version: ${V}, title: Wind }`,
          `traces-to:\n  - { id: ${N1}, version: ${V}, title: Wind }`,
          "---",
          "",
        ].join("\n"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const r = await recordsOf(workspace);
    const graph = derivationGraph(await traceContext(workspace), "trace.chain");
    expect(graph.kinds.map((k) => k.key)).toEqual(["satisfies"]);
    expect(show(parentsOf(graph, r(S1))).steps).toEqual([[N1, S1, "satisfies", ["satisfies", 0]]]);
    expect(show(childrenOf(graph, r(N1))).steps).toEqual([[S1, S1, "satisfies", ["satisfies", 0]]]);
  });
});
