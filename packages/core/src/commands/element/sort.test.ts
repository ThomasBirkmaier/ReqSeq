// element.list sorted (SR-075) on fixtures/SR-075/sort, one repository `system` with the standard
// model and a subtype of system-requirement, software-requirement (SWR, first in the metamodel: its
// file software.yaml is merged before standard-model.yaml), with a number property `priority`:
// - needs N1 "wind" (approved) and N2 "Storms" (draft);
// - SR b1 "Measure wind" (approved, performance): derives from N1;
// - SR b2 "measure Wind" (draft, functional): derives from N1 and N2;
// - SR b3 "Alarm" (obsolete, requirement type "custom", no choice): derives from b1 and from N1;
// - SR b4 "Zero" (draft): no parent, no requirement type;
// - SWR f1 "Filter" (draft, priority 10): derives from b1;
// - SWR f2 "Log" (approved, priority 2): derives from b2, named twice;
// - SWR f3 "Buffer" (draft, no priority): derives from b3.
// Store order: N1, N2, b1, b2, b3, b4, f1, f2, f3.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { resolveSelection, sortElements } from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.list">;

const P = "75075075-0000-4000-8000-0000000000";
const [N1, N2, B1, B2, B3, B4, F1, F2, F3] = ["a1", "a2", "b1", "b2", "b3", "b4", "f1", "f2", "f3"].map(
  (tail) => `${P}${tail}`,
) as [string, string, string, string, string, string, string, string, string];
const STORE = [N1, N2, B1, B2, B3, B4, F1, F2, F3];

const SORT: FixtureOptions = { fixture: "SR-075/sort" };

const open = async (options: FixtureOptions = SORT): Promise<{ workspace: Workspace; root: string }> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, root: fixture.root };
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.list", input, { workspace })) as Output;

const ids = (output: Output): string[] => output.elements.map((e) => e.id);

/** The UUIDs in the order `sort` gives, every element in one page. */
const sorted = async (workspace: Workspace, sort: unknown, selection: unknown = {}): Promise<string[]> =>
  ids(await list(workspace, { sort, selection, limit: 5000 }));

/** The tree as `depth name < parent` lines, the elements named by the tail of their UUID. */
const treeLines = (output: Output): string[] =>
  (output.tree ?? []).map((place, index) => {
    const name = (id: string): string => id.slice(P.length);
    expect([place.id, place.repository]).toEqual([output.elements[index]?.id, "system"]);
    const parent = place.parent === undefined ? "" : ` < ${name(place.parent.id)}`;
    return `${String(place.depth)} ${name(place.id)}${parent}`;
  });

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await list(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("element.list did not fail");
};

/** The code, message and fields of the error `sort` gives. */
const refused = async (workspace: Workspace, sort: unknown): Promise<unknown> => {
  const error = await failure(workspace, { sort });
  return [error.code, error.message, error.details?.["fields"]];
};

/** Every file below `root` with its bytes, by its path relative to `root`. */
const filesOf = async (root: string): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      files.set(path.relative(root, file), (await fs.readFile(file)).toString("base64"));
    }
  }
  return files;
};

describe("element.list sorted by a property (SR-075 AK1)", () => {
  it("[SR-075/AK1] sorts by a property ascending and descending", async () => {
    const { workspace } = await open();
    // Numbers by value (2 before 10); elements without a value last in both orders, in workspace order.
    expect(await sorted(workspace, [{ by: "priority" }])).toEqual([F2, F1, N1, N2, B1, B2, B3, B4, F3]);
    expect(await sorted(workspace, [{ by: "priority", order: "asc" }])).toEqual([
      F2,
      F1,
      N1,
      N2,
      B1,
      B2,
      B3,
      B4,
      F3,
    ]);
    expect(await sorted(workspace, [{ by: "priority", order: "desc" }])).toEqual([
      F1,
      F2,
      N1,
      N2,
      B1,
      B2,
      B3,
      B4,
      F3,
    ]);
    // Within a selection: only its elements, sorted.
    expect(
      await sorted(workspace, [{ by: "priority", order: "desc" }], { where: { type: ["need"] } }),
    ).toEqual([N1, N2]);
  });

  it("[SR-075/AK1] sorts by short ID, type, status and title", async () => {
    const { workspace } = await open();
    expect(await sorted(workspace, [{ by: "id" }])).toEqual(STORE);
    expect(await sorted(workspace, [{ by: "id", order: "desc" }])).toEqual(STORE.toReversed());
    // Types in metamodel order: software-requirement (software.yaml first), need, system-requirement.
    expect(await sorted(workspace, [{ by: "type" }])).toEqual([F1, F2, F3, N1, N2, B1, B2, B3, B4]);
    // Statuses in metamodel order: draft, approved, obsolete.
    expect(await sorted(workspace, [{ by: "status" }])).toEqual([N2, B2, B4, F1, F3, N1, B1, F2, B3]);
    expect(await sorted(workspace, [{ by: "status", order: "desc" }])).toEqual([
      B3,
      N1,
      B1,
      F2,
      N2,
      B2,
      B4,
      F1,
      F3,
    ]);
    // Titles ignoring case; "Measure wind" and "measure Wind" by the text as written ("M" before "m").
    expect(await sorted(workspace, [{ by: "title" }])).toEqual([B3, F3, F1, F2, B1, B2, N2, N1, B4]);
    expect(await sorted(workspace, [{ by: "title", order: "desc" }])).toEqual([
      B4,
      N1,
      N2,
      B2,
      B1,
      F2,
      F1,
      F3,
      B3,
    ]);
    const page = await list(workspace, { sort: [{ by: "title" }], limit: 2, offset: 1 });
    expect([ids(page), page.total, page.tree]).toEqual([[F3, F1], 9, undefined]);
  });

  it("[SR-075/AK1] sorts choices in metamodel order, other values by kind, and elements without a value last", async () => {
    const { workspace } = await open();
    // functional (b2), performance (b1), then the text "custom" (b3), then no value.
    expect(await sorted(workspace, [{ by: "requirement-type" }])).toEqual([
      B2,
      B1,
      B3,
      N1,
      N2,
      B4,
      F1,
      F2,
      F3,
    ]);
    expect(await sorted(workspace, [{ by: "requirement-type", order: "desc" }])).toEqual([
      B3,
      B1,
      B2,
      N1,
      N2,
      B4,
      F1,
      F2,
      F3,
    ]);
    // A key the metamodel does not know (SR-016): numbers, texts ignoring case, booleans; a list by
    // its first item; a mapping, NaN and null are no value.
    const owner = (value: string, index: number): string =>
      `---\nid: ${P}e${String(index)}\ntype: need\nstatus: draft\ntitle: E\nowner: ${value}\n---\n`;
    const values = ["3", "-1.5", "beta", "Alpha", "true", "false", "[2, -9]", "{ a: 1 }", ".nan", "null"];
    const files = Object.fromEntries(values.map((value, i) => [`needs/N-e${String(i)}.md`, owner(value, i)]));
    const { workspace: ws } = await open({ ...SORT, files });
    const output = await list(ws, {
      selection: { where: { property: "title", op: "eq", value: "E" } },
      sort: [{ by: "owner" }],
    });
    const shown = output.elements.map((e) => JSON.stringify(e.properties["owner"] ?? null));
    expect(shown).toEqual([
      "-1.5",
      "[2,-9]",
      "3",
      '"Alpha"',
      '"beta"',
      "false",
      "true",
      '{"a":1}',
      // NaN is null in JSON.
      "null",
      "null",
    ]);
    const descending = await list(ws, {
      selection: { where: { property: "title", op: "eq", value: "E" } },
      sort: [{ by: "owner", order: "desc" }],
    });
    expect(descending.elements.map((e) => JSON.stringify(e.properties["owner"] ?? null))).toEqual([
      "true",
      "false",
      '"beta"',
      '"Alpha"',
      "3",
      "[2,-9]",
      "-1.5",
      '{"a":1}',
      "null",
      "null",
    ]);
  });

  it("[SR-075/AK1] sorts by several keys, ties in workspace order", async () => {
    const { workspace } = await open();
    expect(await sorted(workspace, [{ by: "status" }, { by: "title", order: "desc" }])).toEqual([
      B4,
      N2,
      B2,
      F1,
      F3,
      N1,
      B1,
      F2,
      B3,
    ]);
    // Equal under every key: workspace order, whatever order `ids` names them in.
    expect(await sorted(workspace, [{ by: "type" }], { ids: [B4, B2, N2, N1] })).toEqual([N1, N2, B2, B4]);
    expect(await sorted(workspace, [])).toEqual(STORE);
  });
});

describe("element.list as a derivation tree (SR-075 AK2)", () => {
  it("[SR-075/AK2] shows the elements as a tree of their derivations, depth first with depth and parent", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { sort: [{ by: "hierarchy" }] });
    expect(treeLines(output)).toEqual([
      "0 a1",
      "1 b1 < a1",
      "2 f1 < b1",
      "1 b2 < a1",
      "2 f2 < b2",
      "1 b3 < a1",
      "2 f3 < b3",
      "0 a2",
      "0 b4",
    ]);
    expect(output.total).toBe(9);
    expect(output.tree?.[0]).toEqual({ id: N1, repository: "system", depth: 0 });
    expect(output.tree?.[1]).toEqual({
      id: B1,
      repository: "system",
      depth: 1,
      parent: { id: N1, repository: "system" },
    });
  });

  it("[SR-075/AK2] orders the roots and the elements below each parent by the keys after hierarchy", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { sort: [{ by: "hierarchy" }, { by: "title" }] });
    // Roots by title: Storms (N2), wind (N1), Zero (b4). b2 is below N2 now: its first parent in sort order.
    expect(treeLines(output)).toEqual([
      "0 a2",
      "1 b2 < a2",
      "2 f2 < b2",
      "0 a1",
      "1 b3 < a1",
      "2 f3 < b3",
      "1 b1 < a1",
      "2 f1 < b1",
      "0 b4",
    ]);
  });

  it("[SR-075/AK2] shows an element with several parents once, below the parent at the shortest depth", async () => {
    const { workspace } = await open();
    const lines = treeLines(
      await list(workspace, { sort: [{ by: "hierarchy" }, { by: "title", order: "desc" }] }),
    );
    // b3 derives from b1 and N1: below N1 at depth 1, not below b1 at depth 2. b2 derives from N1 and
    // N2: below N1, the first of the two in this order. f2 names b2 twice and is listed once.
    expect(lines).toEqual([
      "0 b4",
      "0 a1",
      "1 b2 < a1",
      "2 f2 < b2",
      "1 b1 < a1",
      "2 f1 < b1",
      "1 b3 < a1",
      "2 f3 < b3",
      "0 a2",
    ]);
    expect(lines.filter((line) => line.split(" ")[1] === "b3")).toHaveLength(1);
  });

  it("[SR-075/AK2] makes an element whose parent is not in the list a root", async () => {
    const { workspace } = await open();
    const output = await list(workspace, {
      selection: { where: { type: ["system-requirement"] } },
      sort: [{ by: "hierarchy" }],
    });
    expect(treeLines(output)).toEqual([
      "0 b1",
      "1 b3 < b1",
      "2 f3 < b3",
      "1 f1 < b1",
      "0 b2",
      "1 f2 < b2",
      "0 b4",
    ]);
  });

  it("[SR-075/AK2] shows each element of a derivation cycle once, and what hangs below a cycle below it", async () => {
    // c1 <-> c2, c3 below c2; c4 <-> c5, entered from c1 (c4 derives from c1 too); c6 derives from
    // itself; c7 derives from c2 and from the root c8, so it hangs below c8.
    const item = (tail: string): string => `  - { id: ${P}${tail}, version: n1:1111111111111111 }\n`;
    const element = (tail: string, type: string, parents: readonly string[]): string =>
      `---\nid: ${P}${tail}\ntype: ${type}\nstatus: draft\ntitle: Loop ${tail}\nderives-from:\n${parents.map(item).join("")}---\n`;
    const { workspace } = await open({
      ...SORT,
      files: {
        "requirements/SR-0000000000c1.md": element("c1", "system-requirement", ["c2"]),
        "requirements/SR-0000000000c2.md": element("c2", "system-requirement", ["c1"]),
        "requirements/SWR-0000000000c3.md": element("c3", "software-requirement", ["c2"]),
        "requirements/SR-0000000000c4.md": element("c4", "system-requirement", ["c5", "c1"]),
        "requirements/SR-0000000000c5.md": element("c5", "system-requirement", ["c4"]),
        "requirements/SR-0000000000c6.md": element("c6", "system-requirement", ["c6"]),
        "requirements/SR-0000000000c7.md": element("c7", "system-requirement", ["c2", "c8"]),
        "requirements/SR-0000000000c8.md": element("c8", "system-requirement", []),
      },
    });
    const output = await list(workspace, {
      selection: { where: { property: "title", op: "matches", value: "^Loop" } },
      sort: [{ by: "hierarchy" }],
    });
    expect(treeLines(output)).toEqual([
      "0 c1",
      "1 c2 < c1",
      "2 c3 < c2",
      "1 c4 < c1",
      "2 c5 < c4",
      "0 c6",
      "0 c8",
      "1 c7 < c8",
    ]);
    // A cycle with an element below it, entered at its first element in sort order (Loop c2).
    const within = await list(workspace, {
      selection: { ids: [`${P}c1`, `${P}c2`, `${P}c3`, B4] },
      sort: [{ by: "hierarchy" }, { by: "title", order: "desc" }],
    });
    expect(treeLines(within)).toEqual(["0 b4", "0 c2", "1 c3 < c2", "1 c1 < c2"]);
  });

  it("[SR-075/AK2] pages the tree; a parent may lie on an earlier page", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { sort: [{ by: "hierarchy" }], limit: 3, offset: 3 });
    expect([ids(output), output.total]).toEqual([[B2, F2, B3], 9]);
    expect(treeLines(output)).toEqual(["1 b2 < a1", "2 f2 < b2", "1 b3 < a1"]);
    expect((await list(workspace, { sort: [{ by: "hierarchy" }], offset: 9 })).tree).toEqual([]);
  });
});

describe("element.list keeps no order in the files (SR-075 AK3)", () => {
  it("[SR-075/AK3] sorting writes no file, and a created element takes its place without an order in any file", async () => {
    const { workspace, root } = await open();
    const before = await filesOf(root);
    for (const sort of [[{ by: "title" }], [{ by: "hierarchy" }, { by: "priority", order: "desc" }]]) {
      await list(workspace, { sort });
    }
    expect(await filesOf(root)).toEqual(before);
    const created = (await invoke(
      "element.create",
      { type: "software-requirement", title: "Anemometer", properties: { priority: 5 } },
      { workspace },
    )) as CommandOutput<"element.create">;
    const after = await filesOf(root);
    const added = [...after.keys()].filter((file) => !before.has(file));
    expect(added).toHaveLength(1);
    // Every other file is unchanged: no position was written anywhere.
    expect([...before].every(([file, bytes]) => after.get(file) === bytes)).toBe(true);
    // The new file holds what a create without any sort before writes, and no order.
    const { workspace: fresh, root: freshRoot } = await open();
    const other = (await invoke(
      "element.create",
      { type: "software-requirement", title: "Anemometer", properties: { priority: 5 } },
      { workspace: fresh },
    )) as CommandOutput<"element.create">;
    const read = async (folder: string, file: string | undefined): Promise<string> =>
      fs.readFile(path.join(folder, file ?? ""), "utf8");
    const text = await read(root, added[0]);
    const freshFile = [...(await filesOf(freshRoot)).keys()].find((file) => !before.has(file));
    expect(text.replaceAll(created.element.id, "<id>")).toBe(
      (await read(freshRoot, freshFile)).replaceAll(other.element.id, "<id>"),
    );
    expect(text).not.toMatch(/^(order|position|rank|sort)/mu);
    // Its place comes from its priority each time the list is sorted.
    expect(await sorted(workspace, [{ by: "priority" }])).toEqual([
      F2,
      created.element.id,
      F1,
      N1,
      N2,
      B1,
      B2,
      B3,
      B4,
      F3,
    ]);
  });
});

describe("element.list refuses sort keys it cannot apply", () => {
  it("refuses hierarchy after another key, descending hierarchy and a key that holds relations", async () => {
    const { workspace } = await open();
    expect(await refused(workspace, [{ by: "title" }, { by: "hierarchy" }])).toEqual([
      "input.invalid",
      "sort[1].by: hierarchy can only be the first sort key; the keys after it order the elements below each parent",
      ["sort[1].by"],
    ]);
    expect(await refused(workspace, [{ by: "hierarchy", order: "desc" }])).toEqual([
      "input.invalid",
      "sort[0].order: hierarchy sorts ascending only; order the elements below each parent with the keys after it",
      ["sort[0].order"],
    ]);
    expect(await refused(workspace, [{ by: "title" }, { by: "derives-from" }])).toEqual([
      "input.invalid",
      "sort[1].by: Relation Derives from (derives-from) holds relations, which have no order; sort by hierarchy or by another property",
      ["sort[1].by"],
    ]);
    expect(((await refused(workspace, [{ by: "packages" }])) as unknown[])[2]).toEqual(["sort[0].by"]);
  });

  it("refuses title and hierarchy when no key of the metamodel has their meaning (SR-013 AK3)", async () => {
    const bare =
      "logreq-metamodel: 1\ntypes:\n  - { key: need, name: Need, prefix: N, properties: [title] }\nproperties:\n" +
      "  - { key: title, name: Title, kind: text }\nrelations:\n" +
      "  - { key: derives-from, name: Derives from, inverse-name: Derived by }\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n";
    const { workspace } = await open({
      ...SORT,
      files: { "metamodel/standard-model.yaml": bare, "metamodel/software.yaml": "logreq-metamodel: 1\n" },
    });
    for (const by of ["title", "hierarchy"]) {
      const error = await failure(workspace, { sort: [{ by }] });
      expect([error.code, error.details?.["meaning"], error.details?.["command"]]).toEqual([
        "metamodel.meaning-unassigned",
        by === "title" ? "title" : "derivation",
        "element.list",
      ]);
    }
    // The other keys still sort: draft is a status of the metamodel, approved is not (a text after it).
    expect(await sorted(workspace, [{ by: "status" }], { where: { type: ["need"] } })).toEqual([N2, N1]);
  });
});

describe("sortElements", () => {
  it("takes the elements of the store in store order only, as resolveSelection gives them", async () => {
    const { workspace } = await open();
    const selected = await resolveSelection(workspace, {}, "element.list");
    const context = { ...selected, command: "element.list" } as const;
    const hierarchy = [{ by: "hierarchy", order: "asc" }] as const;
    expect(sortElements(context, selected.elements, hierarchy).elements).toHaveLength(9);
    expect(() => sortElements(context, selected.elements.toReversed(), hierarchy)).toThrow(
      "sortElements: the elements must be records of the store, in store order",
    );
  });
});
