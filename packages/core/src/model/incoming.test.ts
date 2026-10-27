import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { IncomingIndex, IncomingLink } from "./incoming.js";
import {
  buildIncomingIndex,
  CARRY_LIMIT,
  incomingFor,
  incomingState,
  incomingTo,
  relationPath,
} from "./incoming.js";
import { setElementStatus } from "./status.js";
import { applyStoreChange, elementStoreState, updateElements } from "./store.js";
import { createElement, updateElement } from "./write.js";

const V = "n1:1111111111111111";
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const N1 = uuid(1);
const S1 = uuid(2);
const S2 = uuid(3);
const P1 = uuid(4);
const VAR1 = uuid(5);
const PKG1 = uuid(6);
const DUP = uuid(7);
const MISSING = uuid(8);
const A1 = uuid(9);

const WORKSPACE = [
  "logreq-workspace: 1",
  "name: Incoming",
  "repositories:",
  "  - { name: system, url: git@example.com:system.git, main: true }",
  "  - { name: platform, url: git@example.com:platform.git, path: ../platform }",
  "  - { name: extra, url: git@example.com:extra.git, path: ../extra }",
  // Not on this machine.
  "  - { name: away, url: git@example.com:away.git, path: ../away }",
  "metamodel: { repository: system, path: metamodel }",
  "",
].join("\n");

/** A relation-valued property with one target (not `many`), next to the standard model. */
const EXTRA_MODEL = [
  "logreq-metamodel: 1",
  "properties:",
  "  - { key: predecessor, name: Predecessor, kind: relation }",
  "",
].join("\n");

const element = (id: string, type: string, frontmatter: readonly string[] = [], text = ""): string =>
  ["---", `id: ${id}`, `type: ${type}`, "status: draft", "title: T", ...frontmatter, "---", text].join("\n");

const S1_FILE = element(
  S1,
  "system-requirement",
  [
    "derives-from:",
    `  - { id: ${N1}, version: ${V}, title: T }`,
    "  - just text",
    `  - { id: ${P1}, version: ${V}, repository: platform }`,
    `  - { id: ${N1}, repository: 5 }`,
    `  - { id: ${A1}, version: ${V}, repository: away }`,
    `validity:\n  - { id: ${VAR1}, version: ${V} }`,
    `packages:\n  - { id: ${PKG1}, version: ${V} }`,
    `predecessor: { id: ${N1}, version: ${V} }`,
    // One target where a list belongs: the value-kind check reports it (SR-085); not indexed.
    `based-on: { id: ${N1}, version: ${V} }`,
    // Not a key of the metamodel.
    `unknown-key:\n  - { id: ${N1}, version: ${V} }`,
    "rationale: Because",
  ],
  [
    "",
    `See [the need](logreq:${N1}?version=${V}).`,
    "",
    `And [P](logreq:${P1}?version=${V}&repository=platform), [old P](logreq:${P1}?version=${V}),`,
    `[gone](logreq:${MISSING}?version=${V}) and [twice](logreq:${DUP}?version=${V}).`,
    "",
  ].join("\n"),
);

const FILES = {
  "system/logreq-workspace.yaml": WORKSPACE,
  "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  "system/metamodel/extra.yaml": EXTRA_MODEL,
  "system/needs/N-000000000001.md": element(N1, "need"),
  "system/requirements/SR-000000000002.md": S1_FILE,
  "system/requirements/SR-000000000003.md": element(S2, "system-requirement", [
    "derives-from:",
    `  - { id: ${S2}, version: ${V} }`,
    `  - { id: ${N1}, version: ${V} }`,
    // A list where one target belongs: the value-kind check reports it (SR-085); not counted.
    `predecessor:\n  - { id: ${N1}, version: ${V} }`,
  ]),
  "system/variants/VAR-000000000005.md": element(VAR1, "variant"),
  "system/packages/PKG-000000000006.md": element(PKG1, "package"),
  "platform/needs/N-000000000004.md": element(P1, "need"),
  "platform/needs/N-000000000007.md": element(DUP, "need"),
  "extra/needs/N-000000000007.md": element(DUP, "need"),
};

const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ files: FILES });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A link as `[kind, source UUID, (repository, key) or line, path or reference]` for comparisons. */
const show = (link: IncomingLink): unknown[] =>
  link.kind === "relation"
    ? ["relation", link.source.id, link.repository, link.key, relationPath(link), link.item]
    : ["reference", link.source.id, link.reference.line, link.reference];

const recordOf = (records: readonly ElementRecord[], id: string): ElementRecord => {
  const found = records.find((r) => r.id === id);
  if (found === undefined) {
    throw new Error(`no element ${id}`);
  }
  return found;
};

describe("incoming relation index (ADR-0008)", () => {
  it("indexes relation kinds, relation-valued properties and inline references by the target they name", async () => {
    const workspace = await open();
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const index = buildIncomingIndex(store, metamodel);
    expect(index.store).toBe(store);
    expect(index.metamodel).toBe(metamodel);
    // The relations in store order of the sources, then per source in the order of its frontmatter
    // keys and by item; then the references in store order and text order.
    expect(incomingTo(index, "system", N1).map(show)).toEqual([
      ["relation", S1, "system", "derives-from", ["derives-from", 0], { id: N1, version: V, title: "T" }],
      ["relation", S1, "system", "predecessor", ["predecessor"], { id: N1, version: V }],
      ["relation", S2, "system", "derives-from", ["derives-from", 1], { id: N1, version: V }],
      ["reference", S1, 23, { id: N1, version: V, line: 23 }],
    ]);
    expect(incomingTo(index, "system", VAR1).map(show)).toEqual([
      ["relation", S1, "system", "validity", ["validity", 0], { id: VAR1, version: V }],
    ]);
    expect(incomingTo(index, "system", PKG1).map(show)).toEqual([
      ["relation", S1, "system", "packages", ["packages", 0], { id: PKG1, version: V }],
    ]);
    // A named repository; a link without one that lies in exactly one other repository counts there.
    const toP1 = [
      [
        "relation",
        S1,
        "platform",
        "derives-from",
        ["derives-from", 2],
        { id: P1, version: V, repository: "platform" },
      ],
      ["reference", S1, 25, { id: P1, version: V, repository: "platform", line: 25 }],
      ["reference", S1, 25, { id: P1, version: V, line: 25 }],
    ];
    expect(incomingTo(index, "platform", P1).map(show)).toEqual(toP1);
    // A repository that is not on this machine is indexed as written.
    expect(incomingTo(index, "away", A1).map(show)).toEqual([
      [
        "relation",
        S1,
        "away",
        "derives-from",
        ["derives-from", 4],
        { id: A1, version: V, repository: "away" },
      ],
    ]);
    // A reference without repository whose target is nowhere: the source's own.
    expect(incomingTo(index, "system", MISSING).map(show)).toEqual([
      ["reference", S1, 26, { id: MISSING, version: V, line: 26 }],
    ]);
    // One whose UUID lies in several other repositories (`ambiguous`, as `resolveReference` finds
    // it): each of them, not the source's own.
    const toDup = [["reference", S1, 26, { id: DUP, version: V, line: 26 }]];
    expect(incomingTo(index, "platform", DUP).map(show)).toEqual(toDup);
    expect(incomingTo(index, "extra", DUP).map(show)).toEqual(toDup);
    expect(incomingTo(index, "system", DUP)).toEqual([]);
    // A relation of an element to itself is kept; nothing points at S1.
    expect(incomingTo(index, "system", S2).map(show)).toEqual([
      ["relation", S2, "system", "derives-from", ["derives-from", 0], { id: S2, version: V }],
    ]);
    expect(incomingTo(index, "system", S1)).toEqual([]);
    // Links to the UUID in another repository, or in none.
    expect(incomingTo(index, "platform", N1)).toEqual([]);
    expect(incomingTo(index, "nowhere", N1)).toEqual([]);
    // Every relation and reference by UUID. Not counted: an item without id or with a `repository`
    // that is no text, a value of the wrong shape, a key the metamodel does not know.
    const counts = (byId: ReadonlyMap<string, readonly unknown[]>): Map<string, number> =>
      new Map([...byId].map(([id, links]) => [id, links.length]));
    expect(counts(index.relationsById)).toEqual(
      new Map([
        [N1, 3],
        [P1, 1],
        [A1, 1],
        [VAR1, 1],
        [PKG1, 1],
        [S2, 1],
      ]),
    );
    expect(counts(index.referencesById)).toEqual(
      new Map([
        [N1, 1],
        [P1, 2],
        [MISSING, 1],
        [DUP, 1],
      ]),
    );
    // The sources are the store's records.
    expect(incomingTo(index, "system", N1)[0]?.source).toBe(recordOf(store.elements, S1));
  });

  it("builds the index once per store and metamodel, and anew for another store", async () => {
    const workspace = await open();
    expect(workspace.peek(incomingState)).toBeUndefined();
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const index = incomingFor(workspace, store, metamodel);
    expect(incomingFor(workspace, store, metamodel)).toBe(index);
    expect(workspace.get(incomingState).get(store)).toBe(index);
    // Another metamodel object (the metamodel was read again): built again for it.
    const reread = { ...metamodel };
    const again = incomingFor(workspace, store, reread);
    expect(again).not.toBe(index);
    expect(again.metamodel).toBe(reread);
    expect(incomingTo(again, "system", N1)).toHaveLength(4);
    // A new store (a change of the files): its own index; the old one stays as it was.
    await workspace.reset(elementStoreState);
    const next = await workspace.get(elementStoreState);
    expect(next).not.toBe(store);
    const nextIndex = incomingFor(workspace, next, metamodel);
    expect(nextIndex.store).toBe(next);
    expect(incomingTo(nextIndex, "system", N1).map(show)).toEqual(incomingTo(index, "system", N1).map(show));
    expect(incomingTo(index, "system", N1)[0]?.source).toBe(recordOf(store.elements, S1));
  });
});

describe("incoming relation index carried over a change of the store (ADR-0008, #184, #267)", () => {
  const openFixture = async (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
    const fixture = await createFixtureWorkspace({ files: FILES });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    return { fixture, workspace };
  };

  /** The index of the current store, as a chain takes it. */
  const indexNow = async (workspace: Workspace): Promise<IncomingIndex> =>
    incomingFor(workspace, await workspace.get(elementStoreState), await workspace.get(metamodelState));

  /** Each list of the index by its UUID, the UUIDs sorted (a carried map may name them in another order). */
  const lists = (index: IncomingIndex): unknown => {
    const sorted = (byId: ReadonlyMap<string, readonly IncomingLink[]>): [string, unknown[]][] =>
      [...byId].sort(([a], [b]) => a.localeCompare(b)).map(([id, links]) => [id, links.map(show)]);
    return { relations: sorted(index.relationsById), references: sorted(index.referencesById) };
  };

  /** What `incomingTo` gives for each UUID of `ids` into each repository of the workspace file. */
  const answers = (index: IncomingIndex, ids: Iterable<string>): unknown =>
    [...new Set(ids)]
      .sort()
      .flatMap((id) =>
        ["system", "platform", "extra", "away"].map((repository) => [
          repository,
          id,
          incomingTo(index, repository, id).map(show),
        ]),
      );

  /**
   * The hook ran (the memo has the index of the new store before anything asked for it), and the
   * carried index equals a fresh build: of the same store, list by list and with the store's own
   * records as sources, and of a fresh workspace that reads the files.
   */
  const expectCarried = async (fixture: FixtureWorkspace, workspace: Workspace): Promise<IncomingIndex> => {
    const store = await workspace.get(elementStoreState);
    const carried = workspace.peek(incomingState)?.get(store);
    if (carried === undefined) {
      throw new Error("the index was not carried over the change");
    }
    expect(carried.store).toBe(store);
    const built = buildIncomingIndex(store, carried.metamodel);
    expect(lists(carried)).toEqual(lists(built));
    for (const links of [...carried.relationsById.values(), ...carried.referencesById.values()]) {
      for (const { source } of links) {
        expect(store.byId.get(source.id)).toContain(source);
      }
    }
    const fresh = new Workspace(fixture.path("system"));
    onTestFinished(() => fresh.close());
    const freshIndex = await indexNow(fresh);
    expect(lists(carried)).toEqual(lists(freshIndex));
    const ids = [...built.relationsById.keys(), ...built.referencesById.keys(), ...store.byId.keys()];
    expect(answers(carried, ids)).toEqual(answers(freshIndex, ids));
    return carried;
  };

  /** Writes and deletes files as the user's editor does and applies them the way the watcher does (SR-007). */
  const external = async (
    fixture: FixtureWorkspace,
    workspace: Workspace,
    files: Readonly<Record<string, string | undefined>>,
  ): Promise<void> => {
    const paths = new Map<string, string[]>();
    for (const [file, text] of Object.entries(files)) {
      if (text === undefined) {
        await fs.rm(fixture.path(file));
      } else {
        await fixture.write(file, text);
      }
      const [repository = "", ...rest] = file.split("/");
      paths.set(repository, [...(paths.get(repository) ?? []), rest.join("/")]);
    }
    const layout = await workspace.get(workspaceLayoutState);
    const changed = await applyStoreChange(workspace, (store) =>
      updateElements(
        store,
        layout,
        new Map([...paths].map(([repository, list]) => [repository, { paths: list }])),
      ),
    );
    expect(changed).toBeDefined();
  };

  it("equals a fresh build after element.update, element.create and element.setStatus", async () => {
    const { fixture, workspace } = await openFixture();
    const index = await indexNow(workspace);
    // A title only: no link changes, every list and link is kept as it was.
    await updateElement(workspace, { ref: N1, title: "A new title" });
    const titled = await expectCarried(fixture, workspace);
    expect(titled.relationsById.get(N1)).toBe(index.relationsById.get(N1));
    expect(titled.referencesById.get(P1)).toBe(index.referencesById.get(P1));
    // S2 gets a validity, a target in another repository and a reference in its text; its links
    // come after those of S1, which are kept as the same objects.
    await updateElement(workspace, {
      ref: S2,
      set: { validity: [{ id: VAR1 }], packages: [{ id: P1, repository: "platform" }] },
      text: `See [the need](logreq:${N1}?version=${V}).\n`,
    });
    const updated = await expectCarried(fixture, workspace);
    expect(updated.relationsById.get(N1)?.[0]).toBe(index.relationsById.get(N1)?.[0]);
    expect(incomingTo(updated, "system", VAR1).map((l) => l.source.id)).toEqual([S1, S2]);
    expect(incomingTo(updated, "platform", P1).map((l) => [l.kind, l.source.id])).toEqual([
      ["relation", S1],
      ["relation", S2],
      ["reference", S1],
      ["reference", S1],
    ]);
    expect(incomingTo(updated, "system", N1).map((l) => [l.kind, l.source.id])).toEqual([
      ["relation", S1],
      ["relation", S1],
      ["relation", S2],
      ["reference", S1],
      ["reference", S2],
    ]);
    // A new need sorts before every other file of its repository (`need/` before `needs/`): its
    // reference comes first.
    await createElement(workspace, {
      type: "need",
      title: "New",
      text: `Points at [the need](logreq:${N1}?version=${V}).\n`,
    });
    const created = await expectCarried(fixture, workspace);
    expect(created.referencesById.get(N1)?.map((l) => l.source.file)).toEqual([
      expect.stringMatching(/^need\//),
      "requirements/SR-000000000002.md",
      "requirements/SR-000000000003.md",
    ]);
    await setElementStatus(workspace, { refs: [S2, N1], status: "approved" });
    await expectCarried(fixture, workspace);
  });

  it("[SR-127/AK3] equals a fresh build after a save and after a change from outside that add and drop a reference in an acceptance criterion (SR-082 AK4)", async () => {
    const { fixture, workspace } = await openFixture();
    await indexNow(workspace);
    await updateElement(workspace, {
      ref: S2,
      set: { "acceptance-criteria": [`Then [the need](logreq:${N1}?version=${V}).`] },
    });
    const saved = await expectCarried(fixture, workspace);
    const criterion = (l: IncomingLink): unknown =>
      l.kind === "reference" ? [l.source.id, l.reference.key, l.reference.item] : undefined;
    expect(
      incomingTo(saved, "system", N1)
        .filter((l) => l.source.id === S2)
        .map(criterion),
    ).toContainEqual([S2, "acceptance-criteria", 0]);
    await external(fixture, workspace, {
      "system/requirements/SR-000000000003.md": element(S2, "system-requirement", [
        `acceptance-criteria:\n  - Plain.\n  - "Also [P](logreq:${P1}?version=${V}&repository=platform)"`,
      ]),
    });
    const changed = await expectCarried(fixture, workspace);
    expect(incomingTo(changed, "platform", P1).map(criterion)).toContainEqual([S2, "acceptance-criteria", 1]);
    expect(incomingTo(changed, "system", N1).filter((l) => l.source.id === S2)).toEqual([]);
  });

  it("equals a fresh build after watcher batches in several repositories", async () => {
    const { fixture, workspace } = await openFixture();
    await indexNow(workspace);
    // A new file in the second repository that points into the first, and one that sorts before
    // every file of the first, in one batch with a change of S1 (N1 dropped from its derivations).
    await external(fixture, workspace, {
      "platform/needs/N-000000000010.md": element(uuid(10), "need", [
        `derives-from:\n  - { id: ${N1}, version: ${V}, repository: system }`,
      ]),
      "system/a/N-000000000011.md": element(uuid(11), "need", [
        `derives-from:\n  - { id: ${N1}, version: ${V} }`,
      ]),
      "system/requirements/SR-000000000002.md": S1_FILE.replace(
        `  - { id: ${N1}, version: ${V}, title: T }\n`,
        "",
      ),
    });
    const batch = await expectCarried(fixture, workspace);
    expect(incomingTo(batch, "system", N1).map((l) => l.source.id)).toEqual([uuid(11), S1, S2, uuid(10), S1]);
    // The source of the only relation to S2 goes: its list is dropped, as a fresh build has none.
    await external(fixture, workspace, { "system/requirements/SR-000000000003.md": undefined });
    const gone = await expectCarried(fixture, workspace);
    expect(gone.relationsById.has(S2)).toBe(false);
    // The UUID of a target changes in place, and the twin in the third repository goes: S1's
    // reference to DUP now points into the platform only.
    await external(fixture, workspace, {
      "system/needs/N-000000000001.md": element(uuid(12), "need", [
        `derives-from:\n  - { id: ${P1}, version: ${V} }`,
      ]),
      "extra/needs/N-000000000007.md": undefined,
    });
    const moved = await expectCarried(fixture, workspace);
    expect(incomingTo(moved, "extra", DUP)).toEqual([]);
    expect(incomingTo(moved, "platform", DUP)).toHaveLength(1);
    // A change in the second repository only.
    await external(fixture, workspace, {
      "platform/needs/N-000000000010.md": element(uuid(10), "need", [
        `derives-from:\n  - { id: ${uuid(11)}, version: ${V}, repository: system }`,
      ]),
    });
    await expectCarried(fixture, workspace);
  });

  it("is not carried over a change of more UUIDs than CARRY_LIMIT: the next chain builds it", async () => {
    const { fixture, workspace } = await openFixture();
    await indexNow(workspace);
    // A pull that brings more new elements than the limit, each pointing at N1.
    const files: Record<string, string> = {};
    for (let n = 0; n <= CARRY_LIMIT; n += 1) {
      files[`system/pulled/N-${String(n).padStart(12, "0")}.md`] = element(uuid(100_000 + n), "need", [
        `derives-from:\n  - { id: ${N1}, version: ${V} }`,
      ]);
    }
    await external(fixture, workspace, files);
    const store = await workspace.get(elementStoreState);
    expect(store.elements.length).toBeGreaterThan(CARRY_LIMIT);
    expect(workspace.peek(incomingState)?.get(store)).toBeUndefined();
    const built = await indexNow(workspace);
    expect(built.store).toBe(store);
    expect(incomingTo(built, "system", N1).filter((l) => l.kind === "relation")).toHaveLength(
      CARRY_LIMIT + 4,
    );
  });

  it("builds nothing for a store without an index, and is dropped when nothing tells what changed", async () => {
    const { fixture, workspace } = await openFixture();
    // The memo is there but holds no index of the store: a save builds none.
    const memo = workspace.get(incomingState);
    await workspace.get(elementStoreState);
    await updateElement(workspace, { ref: N1, title: "Saved" });
    expect(workspace.peek(incomingState)).toBe(memo);
    expect(memo.get(await workspace.get(elementStoreState))).toBeUndefined();
    // An index built with another metamodel object is carried with it; a chain with the current
    // metamodel builds its own.
    const metamodel = await workspace.get(metamodelState);
    const other = { ...metamodel };
    incomingFor(workspace, await workspace.get(elementStoreState), other);
    await updateElement(workspace, { ref: N1, title: "Saved again" });
    const carried = await expectCarried(fixture, workspace);
    expect(carried.metamodel).toBe(other);
    const store = await workspace.get(elementStoreState);
    expect(incomingFor(workspace, store, metamodel)).not.toBe(carried);
    // A replace from outside `applyStoreChange` carries nothing: the memo goes with the old store.
    expect(
      await workspace.replace(elementStoreState, workspace.peek(elementStoreState), Promise.resolve(store)),
    ).toBe(true);
    expect(workspace.peek(incomingState)).toBeUndefined();
  });
});
