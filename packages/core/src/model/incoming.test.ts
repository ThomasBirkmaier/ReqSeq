import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import type { IncomingLink } from "./incoming.js";
import { buildIncomingIndex, incomingFor, incomingState, incomingTo, relationPath } from "./incoming.js";
import { elementStoreState } from "./store.js";

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
