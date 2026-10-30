// The view rule in trace and evidence (SR-041 AK5, SR-043 AK4 to AK7, SR-006 AK2) on
// fixtures/SR-043/example, the example of SR-043 (variant A replaces K1 by A1, excludes K2, adds
// A2), with `CHILDREN` written on top: the core requirement P as parent of K1 to K4, A1 and A2 (P below the need N1), the core
// requirement Q as a second parent of K2 only, and K1c, a child of K1 without validity. Records: K1
// and K2 failed in the core; K3 and K4 passed in the core and in A; A2 and K1c passed in A.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, CommandOutput } from "../catalog.js";
import { verificationOf, verificationState } from "../evidence/index.js";
import { applyStoreChange, elementStoreState, updateElements } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";

const P = "43043043-0000-4000-8000-0000000000";
const NAMES: Readonly<Record<string, string>> = {
  a0: "P",
  a1: "K1",
  a2: "K2",
  a3: "K3",
  a4: "K4",
  a6: "K1c",
  a8: "Q",
  b1: "A1",
  b2: "A2",
  c1: "A",
  c2: "B",
  c3: "C",
  d1: "N1",
};
const name = (id: string): string => NAMES[id.slice(-2)] ?? id.slice(-2);
const A = "VAR-0000c1";
const EXAMPLE = new Set(["K1", "K2", "K3", "K4", "A1", "A2"]);
const VERSION = "n1:67ebd0624004c969";
const ref = (tail: string): string => `{ id: ${P}${tail}, version: ${VERSION}, title: T }`;
const COAST = `validity: [{ id: ${P}c1, version: ${VERSION}, title: Coast }]\n`;
const WORKSPACE = `reqseq-workspace: 1
name: Weather station
repositories:
  - { name: system, url: "git@git.example.com:ws/system.git", main: true }
metamodel: { repository: system, path: metamodel }
evidence:
  - { repository: system, path: evidence }
`;
const ABSENT = WORKSPACE.replace(
  "metamodel:",
  '  - { name: other, url: "git@git.example.com:ws/other.git" }\nmetamodel:',
);

/** A system requirement with tail `tail`, derived from `parents`, with the frontmatter lines `extra`. */
const requirement = (tail: string, parents: readonly string[], extra = "") => ({
  [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: R ${tail}\nderives-from: [${parents.map(ref).join(", ")}]\n${extra}---\n`,
});
/** A test record of the element with tail `tail` for the core or the variant with tail `variant`. */
const record = (tail: string, result: string, variant?: string) => ({
  [`evidence/${tail}-${variant ?? "core"}.md`]: `---\nreqseq-record: 1\nkind: verification\nelement: ${P}${tail}\nversion: ${VERSION}\nmethod: test\nitem: build-43\nresult: ${result}\ndate: 2026-10-30T10:00:00Z\n${variant === undefined ? "" : `variant: ${P}${variant}\n`}---\n`,
});
const CHILDREN: Readonly<Record<string, string>> = {
  "reqseq-workspace.yaml": WORKSPACE,
  ...requirement("a0", ["d1"]),
  ...requirement("a8", ["d1"]),
  ...requirement("a1", ["a0"]),
  ...requirement("a2", ["a0", "a8"]),
  ...requirement("a3", ["a0"]),
  ...requirement("a4", ["a0"]),
  ...requirement("a6", ["a1"]),
  ...requirement("b1", ["a0"], `${COAST}replaces: [${ref("a1")}]\n`),
  ...requirement("b2", ["a0"], COAST),
  ...record("a1", "failed"),
  ...record("a2", "failed"),
  ...record("a3", "passed"),
  ...record("a3", "passed", "c1"),
  ...record("a4", "passed"),
  ...record("a4", "passed", "c1"),
  ...record("b2", "passed", "c1"),
  ...record("a6", "passed", "c1"),
};

const open = async (files: Readonly<Record<string, string>> = {}) => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-043/example",
    files: { ...CHILDREN, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const run = async <C extends CommandName>(workspace: Workspace, command: C, input: unknown) =>
  (await invoke(command, input, { workspace })) as CommandOutput<C>;

/** The verification of each element of `ids` in `view` (`core` or A): status and missing children by name. */
const statusIn = async (workspace: Workspace, ids: readonly string[], view: "core" | "A") => {
  const out = await run(workspace, "evidence.status", { selection: { ids } });
  return Object.fromEntries(
    out.elements.map((e) => {
      const entry = e.verification?.find((v) => (view === "core" ? v.view === "core" : name(v.view) === "A"));
      return [
        name(e.id),
        entry && { status: entry.status, missing: (entry.missingChildren ?? []).map(name) },
      ];
    }),
  );
};

const chainIn = async (workspace: Workspace, ref: string, view = A): Promise<string[]> =>
  (await run(workspace, "trace.chain", { ref, direction: "down", view })).nodes.map((n) => name(n.id));

const coverageIn = async (workspace: Workspace, view: string) => {
  const out = await run(workspace, "evidence.coverage", { selection: { view } });
  const of = (type: string) => out.levels.find((l) => l.type === type)?.elements;
  return { need: of("need"), requirement: of("system-requirement") };
};

const names = (ids: readonly string[] | undefined): string[] => (ids ?? []).map(name);

describe("the view rule in trace and evidence (SR-041 AK5, SR-043)", () => {
  it("[SR-043/AK4] trace.chain in the view of A holds of the requirements only K3, K4, A1 and A2", async () => {
    const { workspace } = await open();
    const chain = await chainIn(workspace, "N-0000d1");
    expect(chain.filter((n) => EXAMPLE.has(n))).toEqual(["K3", "K4", "A1", "A2"]);
    expect((await chainIn(workspace, "N-0000d1", "core")).filter((n) => EXAMPLE.has(n))).toEqual([
      "K1",
      "K2",
      "K3",
      "K4",
    ]);
  });

  it("[SR-043/AK5] evidence.coverage in the view of A counts exactly K3, K4, A1 and A2", async () => {
    const { workspace } = await open();
    const { requirement } = await coverageIn(workspace, A);
    const counted = [...names(requirement?.withChildren), ...names(requirement?.withoutChildren)];
    expect(counted.filter((n) => EXAMPLE.has(n)).sort()).toEqual(["A1", "A2", "K3", "K4"]);
    // Q's only child is K2, which A excludes: Q has children in the core, none in A.
    expect(names(requirement?.withChildren)).toEqual(["P"]);
    expect(names((await coverageIn(workspace, "core")).requirement?.withChildren)).toEqual(["P", "K1", "Q"]);
  });

  it("[SR-043/AK6] evidence.degree in the view of A counts exactly K3, K4, A1 and A2", async () => {
    const { workspace } = await open();
    const ids = ["SR-0000a1", "SR-0000a2", "SR-0000a3", "SR-0000a4", "SR-0000b1", "SR-0000b2"];
    const out = await run(workspace, "evidence.degree", { selection: { ids, view: A } });
    expect(out.degree).toEqual({
      share: 0.75,
      total: 4,
      counts: { open: 1, verified: 3, indirect: 0, failed: 0, outdated: 0 },
    });
  });

  it("[SR-043/AK7] evidence.status indirect in the view of A counts only children from K3, K4, A1 and A2", async () => {
    const { workspace } = await open();
    const parents = ["SR-0000a0", "SR-0000a8"];
    // The core first, so the view of A runs on what the core walk left behind.
    expect(await statusIn(workspace, parents, "core")).toEqual({
      P: { status: "open", missing: ["K1", "K2"] },
      Q: { status: "open", missing: ["K2"] },
    });
    expect(await statusIn(workspace, parents, "A")).toEqual({
      P: { status: "open", missing: ["A1"] },
      Q: { status: "open", missing: [] },
    });
  });

  it("[SR-041/AK5] chain, coverage and indirect verification in A do not hang the children of SR-K under SR-A", async () => {
    const { workspace } = await open();
    expect(await chainIn(workspace, "SR-0000b1")).toEqual(["A1"]);
    const { requirement } = await coverageIn(workspace, A);
    expect([names(requirement?.withoutChildren)].flat()).toEqual(expect.arrayContaining(["A1", "K1c"]));
    // K1c stands where its own validity puts it (in A, verified there); K1 has no row in A (SR-047 AK3).
    expect(await statusIn(workspace, ["SR-0000b1", "SR-0000a6", "SR-0000a1"], "A")).toEqual({
      A1: { status: "open", missing: [] },
      K1c: { status: "verified", missing: [] },
      K1: undefined,
    });
  });

  it("[SR-006/AK2] trace.chain in the view of A is incomplete when a repository of the workspace is absent", async () => {
    const { workspace } = await open({ "reqseq-workspace.yaml": ABSENT });
    const up = { ref: "SR-0000a0", direction: "up" } as const;
    expect((await run(workspace, "trace.chain", up)).incomplete).toBe(false);
    expect((await run(workspace, "trace.chain", { ...up, view: A })).incomplete).toBe(true);
  });

  it("trace.related, graph and neighbourhood in the view of A are incomplete when a repository is absent", async () => {
    const { workspace } = await open({ "reqseq-workspace.yaml": ABSENT });
    const related = { refs: ["SR-0000a0"], direction: "parents" } as const;
    const graph = { ref: "SR-0000a0", maxDepth: 0 };
    const near = { ref: "SR-0000a0", direction: "up" } as const;
    for (const view of [undefined, A]) {
      const v = view === undefined ? {} : { view };
      expect([
        (await run(workspace, "trace.related", { ...related, ...v })).incomplete,
        (await run(workspace, "trace.graph", { ...graph, ...v })).incomplete,
        (await run(workspace, "trace.neighbourhood", { ...near, ...v })).incomplete,
      ]).toEqual([view !== undefined, view !== undefined, view !== undefined]);
    }
  });

  it("trace.related, graph, neighbourhood and matrix in the view of A leave out K1 and K2", async () => {
    const { workspace } = await open();
    const related = await run(workspace, "trace.related", {
      refs: ["SR-0000a0"],
      direction: "children",
      view: A,
    });
    expect(related.elements.map((e) => name(e.id))).toEqual(["K3", "K4", "A1", "A2"]);
    const graph = await run(workspace, "trace.graph", { ref: "SR-0000a0", view: A });
    expect(graph.nodes.map((n) => name(n.id)).sort()).toEqual(["A1", "A2", "K3", "K4", "N1", "P"]);
    const near = await run(workspace, "trace.neighbourhood", {
      ref: "SR-0000a8",
      direction: "down",
      view: A,
    });
    expect(near.nodes.map((n) => name(n.id))).toEqual(["Q"]);
    const matrix = await run(workspace, "trace.matrix", { selection: { ids: ["SR-0000a0"], view: A } });
    const ends = matrix.rows.flatMap((row) => row.cells.flat().map((end) => name(end.id)));
    expect(ends.sort()).toEqual(["A1", "A2", "K3", "K4", "N1"]);
  });

  it("evidence.withoutPassedTest in the view of A lists no requirement A excludes or replaces", async () => {
    const { workspace } = await open();
    const out = await run(workspace, "evidence.withoutPassedTest", { view: A });
    expect(out.elements.map((e) => name(e.id)).sort()).toEqual(["A1", "P", "Q"]);
  });
});

describe("the verification status carried over a change of a rule item (ADR-0008)", () => {
  /** The verification of every element in every view. */
  const table = async (workspace: Workspace) => {
    const status = await workspace.get(verificationState);
    const store = await workspace.get(elementStoreState);
    await status.prepare(store.elements, { own: true });
    return Object.fromEntries(store.elements.map((e) => [name(e.id), verificationOf(status, e)]));
  };

  const a1 = (lines: string): string => Object.values(requirement("b1", ["a0"], lines)).join("");

  const change = async (fixture: FixtureWorkspace, workspace: Workspace, text: string): Promise<void> => {
    await fixture.write("requirements/SR-0000000000b1.md", text);
    const before = workspace.peek(verificationState);
    const layout = await workspace.get(workspaceLayoutState);
    const applied = await applyStoreChange(workspace, (store) =>
      updateElements(store, layout, new Map([["system", { paths: ["requirements/SR-0000000000b1.md"] }]])),
    );
    expect(applied).toBeDefined();
    expect(workspace.peek(verificationState)).not.toBe(before);
    const fresh = new Workspace(fixture.root);
    try {
      expect(await table(workspace)).toEqual(await table(fresh));
    } finally {
      await fresh.close();
    }
  };

  it("adding a replaces, widening the validity, removing the replaces and restoring them equal a fresh status", async () => {
    const { fixture, workspace } = await open();
    await table(workspace);
    const A_ = `{ id: ${P}c1, version: ${VERSION}, title: Coast }`;
    const B_ = `{ id: ${P}c2, version: ${VERSION}, title: Mountain }`;
    // K2 under Q leaves the view of B, though neither Q nor K2 changed.
    await change(
      fixture,
      workspace,
      a1(`validity: [${A_}, ${B_}]\nreplaces: [${ref("a1")}, ${ref("a2")}]\n`),
    );
    await change(fixture, workspace, a1(`validity: [${A_}, ${B_}]\n`));
    await change(fixture, workspace, a1(`validity: [${A_}]\nreplaces: [${ref("a1")}]\n`));
  });
});
