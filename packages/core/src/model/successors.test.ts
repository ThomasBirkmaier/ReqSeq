import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import { buildIncomingIndex, incomingFor, incomingState } from "./incoming.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { applyStoreChange, elementStoreState, updateElements } from "./store.js";
import { buildSuccessionIndex, successionIndexState, successionsFor, successionsOf } from "./successors.js";

/** Elements of fixtures/SR-072/supersede. */
const N_OLD = "7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6";
const N_NEW = "7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7";
const OTHER = "7a1e0c2b-4d3f-4a5b-8c6d-0a0a0a0a0a0a";
const MISSING = "7a1e0c2b-4d3f-4a5b-8c6d-000000000000";
const V = "n1:1111111111111111";

const element = (id: string, type: string, status: string, extra = ""): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: ${status}\ntitle: T\n${extra}---\n`;

const OLD_NEED = element(N_OLD, "need", "obsolete");

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly record: ElementRecord;
}

/** The workspace of the fixture with `files` written on top, and the first record with UUID `id`. */
const open = async (files: Readonly<Record<string, string>>, id = N_OLD): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-072/supersede", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const store = await workspace.get(elementStoreState);
  const [record] = store.byId.get(id) ?? [];
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return { fixture, workspace, record };
};

/** The successions of the record as `[source UUID, relation kind, stored item]`. */
const successions = async (opened: Opened): Promise<unknown[]> => {
  const { workspace, record } = opened;
  const store = await workspace.get(elementStoreState);
  const metamodel = await workspace.get(metamodelState);
  return successionsFor(workspace, store, metamodel, record).map((s) => [s.source.id, s.kind.key, s.item]);
};

describe("successors of a superseded element (SR-072 AK3)", () => {
  it("[SR-072/AK3] reads every item with a UUID under a succession kind that names the element, as the view reads relations", async () => {
    const opened = await open({
      // Its own relation to itself is no successor.
      "needs/N-a1b2c3d4e5f6.md": element(
        N_OLD,
        "need",
        "obsolete",
        `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`,
      ),
      "needs/N-b2c3d4e5f6a7.md": element(
        N_NEW,
        "need",
        "draft",
        [
          "supersedes:",
          "  - just text",
          "  - { id: not-a-uuid }",
          `  - { id: ${MISSING}, version: ${V} }`,
          `  - { id: ${N_OLD}, version: ${V}, repository: elsewhere }`,
          `  - { id: ${N_OLD}, repository: 5 }`,
          // No version and another key: the value-kind check reports the shape (SR-085); it still names the successor.
          `  - { id: ${N_OLD}, title: See the wind, note: x }`,
          `  - { id: ${N_OLD}, version: ${V} }`,
          `refines:\n  - { id: ${N_OLD}, version: ${V} }\n`,
        ].join("\n"),
      ),
      // Not a list: the value-kind check reports it (SR-085).
      "needs/N-0a0a0a0a0a0a.md": element(
        OTHER,
        "need",
        "draft",
        `supersedes: { id: ${N_OLD}, version: ${V} }\n`,
      ),
    });
    expect(await successions(opened)).toEqual([
      [N_NEW, "supersedes", { id: N_OLD, title: "See the wind", note: "x" }],
      [N_NEW, "supersedes", { id: N_OLD, version: V }],
    ]);
  });

  it("[SR-072/AK3] names none for an element with a valid status or a UUID shared by several files", async () => {
    const supersedes = element(N_NEW, "need", "draft", `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`);
    const valid = await open({ "needs/N-b2c3d4e5f6a7.md": supersedes });
    expect(await successions(valid)).toEqual([]);
    // The index is never built for an element with a valid status.
    expect(valid.workspace.peek(successionIndexState)).toBeUndefined();
    const ambiguous = await open({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      // A second file with the UUID makes the target ambiguous (SR-088).
      "needs/copy/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": supersedes,
    });
    expect(await successions(ambiguous)).toEqual([]);
  });

  it("[SR-072/AK3] builds the index once per store and metamodel and one of its own for another store", async () => {
    const opened = await open({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": element(
        N_NEW,
        "need",
        "draft",
        `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`,
      ),
    });
    const { workspace, record } = opened;
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    expect(successionsFor(workspace, store, metamodel, record).map((s) => s.source.id)).toEqual([N_NEW]);
    const memo = workspace.get(successionIndexState);
    const index = memo.get(store);
    expect([index?.store, index?.metamodel]).toEqual([store, metamodel]);
    successionsFor(workspace, store, metamodel, record);
    expect(memo.get(store)).toBe(index);
    // A view built on another store (here: without the successor) gets an index of that store.
    const without = { ...store, elements: store.elements.filter((e) => e.id !== N_NEW) };
    expect(successionsFor(workspace, without, metamodel, record)).toEqual([]);
    expect(memo.get(without)?.store).toBe(without);
    expect(memo.get(store)).toBe(index);
    // Another metamodel builds the index of the store again.
    const other = { ...metamodel };
    expect(successionsFor(workspace, store, other, record).map((s) => s.source.id)).toEqual([N_NEW]);
    expect(memo.get(store)?.metamodel).toBe(other);
    expect(successionsOf(buildSuccessionIndex(without, metamodel), metamodel, record)).toEqual([]);
  });

  it("[SR-072/AK3] follows a watcher batch that removes or adds a relation Supersedes, as a fresh workspace does", async () => {
    const supersedes = `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`;
    const opened = await open({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": element(N_NEW, "need", "draft", supersedes),
    });
    const { fixture, workspace } = opened;
    /** Writes the files as an editor does and applies them the way the watcher does (SR-007). */
    const external = async (files: Readonly<Record<string, string>>): Promise<void> => {
      for (const [file, text] of Object.entries(files)) {
        await fixture.write(file, text);
      }
      const layout = await workspace.get(workspaceLayoutState);
      const changed = await applyStoreChange(workspace, (store) =>
        updateElements(store, layout, new Map([["system", { paths: Object.keys(files) }]])),
      );
      expect(changed).toBeDefined();
    };
    /** The successions now, and those a fresh workspace on the same files gives. */
    const now = async (): Promise<[unknown[], unknown[]]> => {
      const store = await workspace.get(elementStoreState);
      const [record] = store.byId.get(N_OLD) ?? [];
      if (record === undefined) {
        throw new Error("no superseded need");
      }
      const fresh = new Workspace(fixture.root);
      onTestFinished(() => fresh.close());
      const freshStore = await fresh.get(elementStoreState);
      const [freshRecord] = freshStore.byId.get(N_OLD) ?? [];
      const ids = (list: readonly { readonly source: ElementRecord }[]): unknown[] =>
        list.map((s) => [s.source.id, s.source.file]);
      return [
        ids(successionsFor(workspace, store, await workspace.get(metamodelState), record)),
        freshRecord === undefined
          ? []
          : ids(successionsFor(fresh, freshStore, await fresh.get(metamodelState), freshRecord)),
      ];
    };
    expect(await now()).toEqual([[[N_NEW, "needs/N-b2c3d4e5f6a7.md"]], [[N_NEW, "needs/N-b2c3d4e5f6a7.md"]]]);
    await external({ "needs/N-b2c3d4e5f6a7.md": element(N_NEW, "need", "draft") });
    expect(await now()).toEqual([[], []]);
    await external({ "needs/N-0a0a0a0a0a0a.md": element(OTHER, "need", "draft", supersedes) });
    expect(await now()).toEqual([[[OTHER, "needs/N-0a0a0a0a0a0a.md"]], [[OTHER, "needs/N-0a0a0a0a0a0a.md"]]]);
  });

  it("[SR-072/AK3] loads no state, so a view after a write cannot fail when the workspace file broke meanwhile", async () => {
    const opened = await open({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": element(
        N_NEW,
        "need",
        "draft",
        `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`,
      ),
    });
    const { fixture, workspace, record } = opened;
    // What a command read before its write (`contextOf`).
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    // Then the workspace file breaks and the layout and every state on it are reset.
    await fixture.write("reqseq-workspace.yaml", "repositories: [\n");
    await workspace.reset(workspaceLayoutState);
    await expect(workspace.get(elementStoreState)).rejects.toThrow();
    expect(successionsFor(workspace, store, metamodel, record).map((s) => s.source.id)).toEqual([N_NEW]);
  });
});

describe("successors of a superseded element from the incoming index (#272)", () => {
  /** The successions as `[source UUID, relation kind, stored item]`, from `successionsFor` and from the succession index. */
  const both = async (opened: Opened): Promise<[unknown[], unknown[]]> => {
    const { workspace, record } = opened;
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const plain = (
      list: readonly { source: ElementRecord; kind: { key: string }; item: unknown }[],
    ): unknown[] => list.map((s) => [s.source.id, s.kind.key, s.item]);
    return [
      plain(successionsFor(workspace, store, metamodel, record)),
      plain(successionsOf(buildSuccessionIndex(store, metamodel), metamodel, record)),
    ];
  };

  it("names the successors the succession index names, in its order, without building it", async () => {
    const opened = await open({
      // A second kind with the meaning succession, after `supersedes` in metamodel order.
      "metamodel/succession.yaml":
        "reqseq-metamodel: 1\nrelations:\n  - { key: obsoletes, name: Obsoletes, meaning: succession }\n",
      "needs/N-a1b2c3d4e5f6.md": element(
        N_OLD,
        "need",
        "obsolete",
        `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`,
      ),
      // `obsoletes` before `supersedes` in the file; the metamodel lists `supersedes` first. A
      // relation Replaces (meaning replacement, D-020) names no successor (D-059).
      "needs/N-b2c3d4e5f6a7.md": element(
        N_NEW,
        "need",
        "draft",
        [
          "obsoletes:",
          `  - { id: ${N_OLD}, version: ${V} }`,
          `  - { id: ${N_OLD} }`,
          `replaces:\n  - { id: ${N_OLD}, version: ${V} }`,
          "supersedes:",
          "  - just text",
          `  - { id: ${N_OLD}, version: ${V}, repository: elsewhere }`,
          `  - { id: ${N_OLD}, title: See the wind }`,
          `refines:\n  - { id: ${N_OLD}, version: ${V} }\n`,
        ].join("\n"),
      ),
      "needs/N-0a0a0a0a0a0a.md": element(
        OTHER,
        "need",
        "draft",
        `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`,
      ),
    });
    const { workspace } = opened;
    const without = await both(opened);
    expect(without[0]).toEqual(without[1]);
    expect(workspace.peek(successionIndexState)).toBeDefined();
    // Once a chain built the incoming index, the view reads it and builds no succession index.
    await workspace.reset(successionIndexState);
    incomingFor(workspace, await workspace.get(elementStoreState), await workspace.get(metamodelState));
    const [indexed, built] = await both(opened);
    expect(indexed).toEqual(built);
    expect(indexed).toEqual([
      [OTHER, "supersedes", { id: N_OLD, version: V }],
      [N_NEW, "supersedes", { id: N_OLD, title: "See the wind" }],
      [N_NEW, "obsoletes", { id: N_OLD, version: V }],
      [N_NEW, "obsoletes", { id: N_OLD }],
    ]);
    expect(workspace.peek(successionIndexState)).toBeUndefined();
  });

  it("names none from the index for an element whose UUID several files share or that nothing points at", async () => {
    const supersedes = element(N_NEW, "need", "draft", `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`);
    const opened = await open({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/copy/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": supersedes,
      "needs/N-0a0a0a0a0a0a.md": element(OTHER, "need", "obsolete"),
    });
    const store = await opened.workspace.get(elementStoreState);
    incomingFor(opened.workspace, store, await opened.workspace.get(metamodelState));
    expect(await both(opened)).toEqual([[], []]);
    const [alone] = store.byId.get(OTHER) ?? [];
    if (alone === undefined) {
      throw new Error("no superseded need without successors");
    }
    expect(await both({ ...opened, record: alone })).toEqual([[], []]);
    expect(opened.workspace.peek(successionIndexState)).toBeUndefined();
  });

  it("uses the succession index when the incoming index has another metamodel or cannot hold a succession kind", async () => {
    const opened = await open({
      "needs/N-a1b2c3d4e5f6.md": OLD_NEED,
      "needs/N-b2c3d4e5f6a7.md": element(
        N_NEW,
        "need",
        "draft",
        `supersedes:\n  - { id: ${N_OLD}, version: ${V} }\n`,
      ),
    });
    const { workspace, record } = opened;
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const memo = workspace.get(incomingState);
    // An index built with another metamodel object.
    memo.set(store, buildIncomingIndex(store, { ...metamodel }));
    expect(successionsFor(workspace, store, metamodel, record).map((s) => s.source.id)).toEqual([N_NEW]);
    expect(workspace.peek(successionIndexState)?.get(store)?.metamodel).toBe(metamodel);
    // A property with the key of a succession kind (the loader refuses it, ADR-0004): the incoming
    // index holds no relations under it, the succession index does.
    const shadowed = {
      ...metamodel,
      properties: [...metamodel.properties, { key: "supersedes", name: "Supersedes", kind: "text" as const }],
    };
    memo.set(store, buildIncomingIndex(store, shadowed));
    expect(successionsFor(workspace, store, shadowed, record).map((s) => s.source.id)).toEqual([N_NEW]);
    expect(workspace.peek(successionIndexState)?.get(store)?.metamodel).toBe(shadowed);
  });
});
