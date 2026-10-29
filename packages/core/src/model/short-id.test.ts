import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import { Workspace } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import {
  SHORT_ID_MIN_LENGTH,
  UNKNOWN_TYPE_PREFIX,
  buildShortIds,
  shortIdGroup,
  shortIdState,
  updateShortIds,
} from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

// UUIDs (version 4) whose ends are chosen to collide. Hex digits without dashes, from the end:
// PAIR_1 and PAIR_2 share 6 digits (abc123), the 7th differs.
const PAIR_1 = "a1b2c3d4-0000-4000-8000-000001abc123";
const PAIR_2 = "b1b2c3d4-0000-4000-9000-000002abc123";
// GROUP_A and GROUP_B share 7 digits (1abc123), GROUP_C shares 6 with both (abc123).
const GROUP_A = "d1b2c3d4-0000-4000-8000-0000a1abc123";
const GROUP_B = "e1b2c3d4-0000-4000-8000-0000b1abc123";
const GROUP_C = "f1b2c3d4-0000-4000-8000-0000c2abc123";
// LONG_X and LONG_Y share 14 digits across the last dash (01abcdefabcdef), more than a file name has.
const LONG_X = "aaaaaaaa-aaaa-4aaa-8a01-abcdefabcdef";
const LONG_Y = "bbbbbbbb-bbbb-4bbb-9b01-abcdefabcdef";
// The elements of fixtures/SR-003/moved.
const MOVED_SR = "5cb1e198-1130-4a13-9d25-88cc6ebc472a";
const MOVED_N = "224dedea-c0ac-4ec8-a228-8beffcbd8c26";

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const elementFile = (id: string, type = "system-requirement"): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: T\n---\n\nText.\n`;

/** The file name of D-056: prefix, dash, the last 12 hex digits of the UUID. */
const fileName = (prefix: string, id: string): string => `${prefix}-${id.slice(-12)}.md`;

/** Element files in `requirements/` of fixtures/SR-003/moved (types need and system-requirement). */
const moved = async (ids: readonly string[]): Promise<FixtureWorkspace> =>
  fixture({
    fixture: "SR-003/moved",
    files: Object.fromEntries(ids.map((id) => [`requirements/${fileName("SR", id)}`, elementFile(id)])),
  });

/** LONG_X and LONG_Y: their file names are the same, so they lie in different folders. */
const longPair = async (): Promise<FixtureWorkspace> =>
  fixture({
    fixture: "SR-003/moved",
    files: {
      [`a/${fileName("SR", LONG_X)}`]: elementFile(LONG_X),
      [`b/${fileName("SR", LONG_Y)}`]: elementFile(LONG_Y),
    },
  });

const read = async (workspace: Workspace): Promise<{ store: ElementStore; shortIds: ShortIds }> => ({
  store: await workspace.get(elementStoreState),
  shortIds: await workspace.get(shortIdState),
});

const only = (store: ElementStore, id: string): ElementRecord => {
  const [record, ...others] = store.byId.get(id) ?? [];
  if (record === undefined || others.length > 0) {
    throw new Error(`expected one element ${id}`);
  }
  return record;
};

/** Short ID of every element, by UUID. */
const shown = (store: ElementStore, shortIds: ShortIds): Record<string, string> =>
  Object.fromEntries(store.elements.map((e) => [e.id, shortIds.of(e)]));

const isShortId = fileSchemaValidator("common.schema.json#/$defs/shortId");

/** Content and modification time of every file below `root`, by path relative to it. */
const filesBelow = async (root: string): Promise<Map<string, readonly [string, number]>> => {
  const result = new Map<string, readonly [string, number]>();
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      const stat = await fs.stat(file);
      result.set(path.relative(root, file).split(path.sep).join("/"), [
        await fs.readFile(file, "utf8"),
        stat.mtimeMs,
      ]);
    }
  }
  return result;
};

/** A plain element record for tests that need no files. */
const record = (id: string, type: string): ElementRecord => ({
  id,
  type,
  repository: "main",
  file: `${id}.md`,
  data: { id, type },
  eol: "\n",
  closingEol: "\n",
  bom: false,
  snapshot: { path: `${id}.md`, size: 0, mtimeMs: 0, sha256: "" },
});

const byIdOf = (records: readonly ElementRecord[]): Map<string, ElementRecord[]> => {
  const byId = new Map<string, ElementRecord[]>();
  for (const r of records) {
    byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  }
  return byId;
};

/** Random UUIDs version 4 from a fixed seed (mulberry32), the same on every run. */
const generatedUuids = (count: number, seed: number): string[] => {
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (): string => Math.floor(next() * 16).toString(16);
  const ids = new Set<string>();
  while (ids.size < count) {
    const digits = Array.from({ length: 32 }, hex);
    digits[12] = "4";
    digits[16] = "89ab".charAt(Math.floor(next() * 4));
    const d = digits.join("");
    ids.add(`${d.slice(0, 8)}-${d.slice(8, 12)}-${d.slice(12, 16)}-${d.slice(16, 20)}-${d.slice(20)}`);
  }
  return [...ids];
};

const metamodelOf = async (): Promise<Metamodel> => open((await moved([])).root).get(metamodelState);

describe("short IDs", () => {
  it("[SR-084/AK1] shows the prefix of the element's type and the last 6 digits of its UUID", async () => {
    const { store, shortIds } = await read(open((await moved([PAIR_1])).root));
    expect(shown(store, shortIds)).toEqual({
      [MOVED_N]: "N-bd8c26",
      [MOVED_SR]: "SR-bc472a",
      [PAIR_1]: "SR-abc123",
    });
    for (const shortId of Object.values(shown(store, shortIds))) {
      expect(isShortId(shortId)).toBe(true);
    }
  });

  it("[SR-084/AK1] shows the prefix of their type for elements of every repository of the workspace", async () => {
    const ws = await fixture({ fixture: "SR-004/three-repositories" });
    const { store, shortIds } = await read(open(ws.path("system")));
    expect(store.elements.map((e) => [e.repository, shortIds.of(e)])).toEqual([
      ["system", "SR-3a2dd1"],
      ["product", "N-5f9cf4"],
      ["sensor", "SR-0784bf"],
    ]);
  });

  it("[SR-084/AK2] lengthens both short forms of UUIDs that end on the same 6 digits until they differ", async () => {
    const { store, shortIds } = await read(open((await moved([PAIR_1, PAIR_2])).root));
    expect(shown(store, shortIds)).toEqual({
      [MOVED_N]: "N-bd8c26",
      [MOVED_SR]: "SR-bc472a",
      [PAIR_1]: "SR-1abc123",
      [PAIR_2]: "SR-2abc123",
    });
  });

  it("[SR-084/AK2] keeps the short form unique in the whole workspace, across repositories and types", async () => {
    // The new need in `product` ends like the system requirement in `system` (3a2dd1).
    const need = "6f1c2a3b-4d5e-4f60-9a7b-c0ffe03a2dd1";
    const ws = await fixture({
      fixture: "SR-004/three-repositories",
      files: { [`product/${fileName("N", need)}`]: elementFile(need, "need") },
    });
    const { store, shortIds } = await read(open(ws.path("system")));
    expect(store.elements.map((e) => [e.repository, shortIds.of(e)])).toEqual([
      ["system", "SR-63a2dd1"],
      ["product", "N-5f9cf4"],
      ["product", "N-03a2dd1"],
      ["sensor", "SR-0784bf"],
    ]);
  });

  it("[SR-084/AK2] gives each element of a group the shortest tail that no other UUID ends with", async () => {
    const { store, shortIds } = await read(open((await moved([GROUP_A, GROUP_B, GROUP_C])).root));
    expect(shown(store, shortIds)).toMatchObject({
      [GROUP_A]: "SR-a1abc123",
      [GROUP_B]: "SR-b1abc123",
      [GROUP_C]: "SR-2abc123",
    });
    const hex = store.elements.map((e) => e.id.replaceAll("-", ""));
    for (const element of store.elements) {
      const tail = shortIds.tail(element.id);
      expect(hex.filter((h) => h.endsWith(tail))).toEqual([element.id.replaceAll("-", "")]);
    }
  });

  it("[SR-084/AK2] lengthens across the dashes of the UUID, digits only", async () => {
    const { store, shortIds } = await read(open((await longPair()).root));
    expect(shown(store, shortIds)).toMatchObject({
      [LONG_X]: "SR-a01abcdefabcdef",
      [LONG_Y]: "SR-b01abcdefabcdef",
    });
    expect(isShortId("SR-a01abcdefabcdef")).toBe(true);
  });

  it("[SR-084/AK2] gives the same short IDs whatever the order of the elements", async () => {
    const metamodel = await metamodelOf();
    const records = [PAIR_2, GROUP_C, LONG_Y, PAIR_1, GROUP_A, LONG_X, GROUP_B].map((id) =>
      record(id, "system-requirement"),
    );
    const forward = buildShortIds(byIdOf(records), metamodel);
    const backward = buildShortIds(byIdOf([...records].reverse()), metamodel);
    expect(records.map((r) => backward.of(r))).toEqual(records.map((r) => forward.of(r)));
    expect(records.map((r) => forward.of(r))).toEqual([
      "SR-02abc123",
      "SR-c2abc123",
      "SR-b01abcdefabcdef",
      "SR-01abc123",
      "SR-a1abc123",
      "SR-a01abcdefabcdef",
      "SR-b1abc123",
    ]);
  });

  it("[SR-084/AK2] gives 50,000 elements unique, minimal short IDs that find their element (N-036)", async () => {
    const metamodel = await metamodelOf();
    const ids = generatedUuids(50_000, 84);
    const records = ids.map((id, i) => record(id, i % 2 === 0 ? "system-requirement" : "need"));
    const shortIds = buildShortIds(byIdOf(records), metamodel);
    const all = records.map((r) => shortIds.of(r));
    expect(new Set(all).size).toBe(records.length);
    // The tails alone are unique too, whatever the type (AK2 across types, review of #155 on #72).
    expect(new Set(records.map((r) => shortIds.tail(r.id))).size).toBe(records.length);
    const hex = ids.map((id) => id.replaceAll("-", ""));
    const lengthened: string[] = [];
    for (const [i, r] of records.entries()) {
      const tail = shortIds.tail(r.id);
      expect(tail.length).toBeGreaterThanOrEqual(SHORT_ID_MIN_LENGTH);
      expect(shortIds.find(all[i] ?? "")).toEqual({ kind: "found", element: r });
      if (tail.length > SHORT_ID_MIN_LENGTH) {
        lengthened.push(tail);
      }
    }
    // At 50,000 elements about 75 short forms of 6 digits are taken twice (D-056).
    expect(lengthened.length).toBeGreaterThan(50);
    for (const tail of lengthened) {
      // One digit less would not be unique: the tail is no longer than it must be.
      expect(hex.filter((h) => h.endsWith(tail.slice(1))).length).toBeGreaterThan(1);
    }
    // The test checks uniqueness and minimality, not time (the perf suite measures, ADR-0011). It
    // takes about 2 s alone on 4 cores and went over the 5 s default under the full suite with coverage
    // (#199), so it gets a bound that only a hang reaches.
  }, 30_000);

  it("[SR-084/AK3] changes no file name and no file when a short ID is lengthened in the display", async () => {
    const ws = await moved([PAIR_1]);
    const workspace = open(ws.root);
    const before = await read(workspace);
    expect(before.shortIds.of(only(before.store, PAIR_1))).toBe("SR-abc123");
    const files = await filesBelow(ws.root);

    // A second element whose UUID ends the same way: the short ID of the first one grows.
    const added = `requirements/${fileName("SR", PAIR_2)}`;
    await ws.write(added, elementFile(PAIR_2));
    await workspace.reset(elementStoreState);
    const after = await read(workspace);
    expect(after.shortIds.of(only(after.store, PAIR_1))).toBe("SR-1abc123");
    expect(after.shortIds.of(only(after.store, PAIR_2))).toBe("SR-2abc123");

    const filesAfter = await filesBelow(ws.root);
    filesAfter.delete(added);
    expect(filesAfter).toEqual(files);
    expect(only(after.store, PAIR_1).file).toBe("requirements/SR-000001abc123.md");
  });

  it("[SR-084/AK3] keeps file names of 12 digits when the short IDs are longer than that", async () => {
    const ws = await longPair();
    const files = await filesBelow(ws.root);
    const { store, shortIds } = await read(open(ws.root));
    expect([LONG_X, LONG_Y].map((id) => [only(store, id).file, shortIds.of(only(store, id))])).toEqual([
      ["a/SR-abcdefabcdef.md", "SR-a01abcdefabcdef"],
      ["b/SR-abcdefabcdef.md", "SR-b01abcdefabcdef"],
    ]);
    expect(await filesBelow(ws.root)).toEqual(files);
  });

  it("shows an element of a type the metamodel does not know with the prefix UNKNOWN (decision on #154)", async () => {
    const id = "0a1b2c3d-0000-4000-8000-0000000beef1";
    const ws = await fixture({
      fixture: "SR-003/moved",
      files: { "hazards/HAZ-0000000beef1.md": elementFile(id, "hazard") },
    });
    const { store, shortIds } = await read(open(ws.root));
    expect(shortIds.of(only(store, id))).toBe(`${UNKNOWN_TYPE_PREFIX}-0beef1`);
    expect(shortIds.find("UNKNOWN-0beef1")).toEqual({ kind: "found", element: only(store, id) });
  });

  it("gives files that share a UUID the same short ID without failing (SR-088 reports them)", async () => {
    const ws = await fixture({
      fixture: "SR-003/moved",
      files: {
        [`requirements/${fileName("SR", PAIR_1)}`]: elementFile(PAIR_1),
        [`copy/${fileName("SR", PAIR_1)}`]: elementFile(PAIR_1),
      },
    });
    const { store, shortIds } = await read(open(ws.root));
    const copies = store.byId.get(PAIR_1) ?? [];
    expect(copies.map((e) => [e.file, shortIds.of(e)])).toEqual([
      ["copy/SR-000001abc123.md", "SR-abc123"],
      ["requirements/SR-000001abc123.md", "SR-abc123"],
    ]);
    expect(shortIds.find("SR-abc123")).toEqual({ kind: "ambiguous", elements: copies });
  });

  it("is built again when the element store or the metamodel is reset", async () => {
    const ws = await moved([PAIR_1]);
    const workspace = open(ws.root);
    const first = await workspace.get(shortIdState);
    expect(await workspace.get(shortIdState)).toBe(first);

    await ws.write(`requirements/${fileName("SR", PAIR_2)}`, elementFile(PAIR_2));
    await workspace.reset(elementStoreState);
    const second = await read(workspace);
    expect(second.shortIds).not.toBe(first);
    expect(second.shortIds.of(only(second.store, PAIR_1))).toBe("SR-1abc123");

    const model = path.join(ws.root, "metamodel/model.yaml");
    await fs.writeFile(model, (await fs.readFile(model, "utf8")).replace("prefix: SR", "prefix: SYS"));
    await workspace.reset(metamodelState);
    const third = await read(workspace);
    expect(third.shortIds.of(only(third.store, PAIR_1))).toBe("SYS-1abc123");
  });
});

describe("ShortIds.find", () => {
  const shortIdsOf = async (ids: readonly string[]): Promise<{ store: ElementStore; shortIds: ShortIds }> =>
    read(open((await moved(ids)).root));

  it("finds an element by its short ID, by a longer tail and by all 32 digits", async () => {
    const { store, shortIds } = await shortIdsOf([PAIR_1, PAIR_2]);
    const found = { kind: "found", element: only(store, PAIR_1) };
    expect(shortIds.find("SR-1abc123")).toEqual(found);
    expect(shortIds.find("SR-000001abc123")).toEqual(found);
    expect(shortIds.find(`SR-${PAIR_1.replaceAll("-", "")}`)).toEqual(found);
    expect(shortIds.find("SR-bc472a")).toEqual({ kind: "found", element: only(store, MOVED_SR) });
  });

  it("reports a tail shorter than the one shown as ambiguous, ordered by UUID digits from the end", async () => {
    const { store, shortIds } = await shortIdsOf([PAIR_2, PAIR_1]);
    expect(shortIds.find("SR-abc123")).toEqual({
      kind: "ambiguous",
      elements: [only(store, PAIR_1), only(store, PAIR_2)],
    });
  });

  it("lets the prefix tell elements of different types apart", async () => {
    const need = "6f1c2a3b-4d5e-4f60-9a7b-c0ffe03a2dd1";
    const ws = await fixture({
      fixture: "SR-004/three-repositories",
      files: { [`product/${fileName("N", need)}`]: elementFile(need, "need") },
    });
    const { store, shortIds } = await read(open(ws.path("system")));
    expect(shortIds.find("N-3a2dd1")).toEqual({ kind: "found", element: only(store, need) });
    expect(shortIds.find("SR-3a2dd1")).toEqual({
      kind: "found",
      element: only(store, "2525fbab-1344-4bcf-8a35-4b4da63a2dd1"),
    });
  });

  it("lists the elements whose UUID ends with a tail, whatever the prefix, without finding them (#275)", async () => {
    const { store, shortIds } = await shortIdsOf([PAIR_1, PAIR_2]);
    expect(shortIds.find("SR-bd8c26")).toEqual({ kind: "unknown" });
    expect(shortIds.withTail("SR-bd8c26")).toEqual([only(store, MOVED_N)]);
    expect(shortIds.withTail("UC-abc123")).toEqual([only(store, PAIR_1), only(store, PAIR_2)]);
    expect(shortIds.withTail("SR-fedcba")).toEqual([]);
    expect(shortIds.withTail(PAIR_1)).toEqual([]);
  });

  it("[SR-060/AK1] finds a short ID in any case (#309)", async () => {
    const { shortIds } = await shortIdsOf([PAIR_1, PAIR_2]);
    const found = shortIds.find("SR-1abc123");
    expect(found.kind).toBe("found");
    for (const ref of ["sr-1abc123", "SR-1ABC123", "sR-1AbC123"]) {
      expect(shortIds.find(ref)).toEqual(found);
      expect(shortIds.withTail(ref)).toEqual(shortIds.withTail("SR-1abc123"));
    }
  });

  it("reports a wrong prefix, an unknown tail and a malformed short ID as unknown", async () => {
    const { shortIds } = await shortIdsOf([PAIR_1, PAIR_2]);
    for (const ref of [
      "N-1abc123",
      "SR-9abc123",
      "SR-fedcba",
      "SR-abc12",
      "1abc123",
      "SR-1abc123-",
      `SR-0${PAIR_1.replaceAll("-", "")}`,
    ]) {
      expect(shortIds.find(ref)).toEqual({ kind: "unknown" });
    }
  });
});

describe("ShortIds.tail", () => {
  it("tells a UUID of no element apart from every element of the workspace", async () => {
    const shortIds = buildShortIds(byIdOf([record(PAIR_1, "need")]), await metamodelOf());
    expect(shortIds.tail(PAIR_1)).toBe("abc123");
    expect(shortIds.tail("12345678-0000-4000-8000-000003abc123")).toBe("3abc123");
    expect(shortIds.tail("12345678-0000-4000-8000-000000000000")).toBe("000000");
    expect(buildShortIds(new Map(), await metamodelOf()).tail(PAIR_1)).toBe("abc123");
  });
});

describe("updateShortIds (#184)", () => {
  const record = (id: string, file: string, type = "system-requirement"): ElementRecord => ({
    id,
    type,
    repository: "system",
    file,
    data: { id, type, status: "draft", title: "T" },
    eol: "\n",
    closingEol: "\n",
    bom: false,
    snapshot: { path: file, size: 1, mtimeMs: 1, sha256: "0".repeat(64) },
  });

  const byIdOf = (records: readonly ElementRecord[]): Map<string, ElementRecord[]> => {
    const byId = new Map<string, ElementRecord[]>();
    for (const r of records) {
      byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    }
    return byId;
  };

  /** UUIDs of no element whose ends lie in the groups above, for `tail`. */
  const PROBES = ["c1b2c3d4-0000-4000-8000-000003abc123", "aaaaaaaa-aaaa-4aaa-8a02-abcdefabcdef", MOVED_N];

  /** What a caller can see of short IDs: every element's short ID, what it and longer tails find, probes. */
  const seen = (shortIds: ShortIds, byId: ReadonlyMap<string, readonly ElementRecord[]>): unknown => {
    const elements = [...byId.values()].flat();
    return {
      of: elements.map((e) => shortIds.of(e)),
      find: elements.map((e) => [
        shortIds.find(shortIds.of(e)),
        shortIds.find(`SR-${e.id.slice(-12)}`),
        shortIds.find(`SR-${e.id.slice(-6)}`),
      ]),
      tails: PROBES.map((id) => shortIds.tail(id)),
    };
  };

  const metamodelOf = async (): Promise<Metamodel> => open((await moved([])).root).get(metamodelState);

  it("equals a fresh build after a create, an update, a move, a copy and a removal", async () => {
    const metamodel = await metamodelOf();
    const a = record(PAIR_1, "requirements/a.md");
    const b = record(GROUP_A, "requirements/b.md");
    const c = record(GROUP_C, "requirements/c.md");
    const x = record(LONG_X, "requirements/x.md");
    const steps: { records: ElementRecord[]; ids: string[] }[] = [
      // A new UUID that collides with PAIR_1: both grow.
      { records: [a, b, c, x, record(PAIR_2, "requirements/p.md")], ids: [PAIR_2] },
      // An update: the same UUID, another record and type.
      { records: [a, b, c, x, record(PAIR_2, "requirements/p.md", "need")], ids: [PAIR_2] },
      // A move and a copy (SR-088): two records of one UUID.
      {
        records: [a, b, c, x, record(PAIR_2, "moved/p.md", "need"), record(GROUP_A, "copies/b.md")],
        ids: [PAIR_2, GROUP_A],
      },
      // GROUP_B joins, LONG_Y joins, PAIR_1 is gone.
      {
        records: [
          b,
          c,
          x,
          record(PAIR_2, "moved/p.md", "need"),
          record(GROUP_A, "copies/b.md"),
          record(GROUP_B, "requirements/gb.md"),
          record(LONG_Y, "requirements/y.md"),
        ],
        ids: [PAIR_1, GROUP_B, LONG_Y],
      },
      // GROUP_B is gone: GROUP_A shares 6 digits only, its short ID gets shorter.
      {
        records: [
          b,
          c,
          x,
          record(PAIR_2, "moved/p.md", "need"),
          record(GROUP_A, "copies/b.md"),
          record(LONG_Y, "requirements/y.md"),
        ],
        ids: [GROUP_B],
      },
      // Every element of a group is gone; nothing else changes.
      { records: [x, record(LONG_Y, "requirements/y.md")], ids: [GROUP_A, GROUP_B, GROUP_C, PAIR_2] },
      // No UUID changed.
      { records: [x, record(LONG_Y, "requirements/y.md")], ids: [] },
    ];
    let byId = byIdOf([a, b, c, x]);
    let shortIds = buildShortIds(byId, metamodel);
    for (const step of steps) {
      // Records of UUIDs that did not change stay the same objects, as the store keeps them.
      const next = byIdOf(
        step.records.map((r) =>
          step.ids.includes(r.id) ? r : (byId.get(r.id)?.find((o) => o.file === r.file) ?? r),
        ),
      );
      const before = seen(shortIds, byId);
      const updated = updateShortIds(shortIds, next, step.ids);
      expect(seen(updated, next)).toEqual(seen(buildShortIds(next, metamodel), next));
      // The short IDs before stay as they were, for a command that still holds them.
      expect(seen(shortIds, byId)).toEqual(before);
      byId = next;
      shortIds = updated;
    }
  });

  it("refuses short IDs it did not build", () => {
    const foreign: ShortIds = {
      of: () => "",
      tail: () => "",
      find: () => ({ kind: "unknown" }),
      withTail: () => [],
      identifierOf: () => undefined,
      withIdentifier: () => [],
    };
    expect(() => updateShortIds(foreign, new Map(), [])).toThrow("needs short IDs from buildShortIds");
  });

  it("groups a UUID by its last 6 hex digits", () => {
    expect(shortIdGroup(PAIR_1)).toBe(shortIdGroup(PAIR_2));
    expect(shortIdGroup(PAIR_1)).not.toBe(shortIdGroup(LONG_X));
    expect(shortIdGroup(PAIR_1)).toBe("abc123");
    // Something else than a UUID: dashes near the end are skipped.
    expect(shortIdGroup("aaaa-bb-cc")).toBe("aabbcc");
  });
});
