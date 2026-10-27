// trace.matrix through `invoke` (SR-125, N-076, D-062): the data of the acceptance criteria on
// fixtures/SR-125/matrix, one repository `system` with the standard model:
// - needs N1 and N2, decision D1, packages P1 (Stage 3) and P2 (Stage 4), variant V1;
// - SR S1 (P1) derives from N1 (current version) and is based on D1; S2 (P1) derives from N1 (an
//   older version) and N2; S3 (P1) has no derivation but refines S1; S4 (P1) derives from S1 (its
//   current version) and from an element that is not there; S5 (P1) derives from S1 (an older
//   version); S6 (P2) derives from N1 (an older version);
// - the saved filter "Stage SRs": the system requirements of P1, sorted by title descending.
// The AK5 (opening an element) is the app's. The same matrix on every access: cross-access.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"trace.matrix">;
type ListOutput = CommandOutput<"element.list">;

const P = "5e125a7d-2b4f-4c61-9d08-";
const ID = {
  N1: `${P}0a0000000001`,
  N2: `${P}0a0000000002`,
  D1: `${P}0d0000000001`,
  P1: `${P}0e0000000001`,
  P2: `${P}0e0000000002`,
  V1: `${P}0f0000000001`,
  S1: `${P}0b0000000001`,
  S2: `${P}0b0000000002`,
  S3: `${P}0b0000000003`,
  S4: `${P}0b0000000004`,
  S5: `${P}0b0000000005`,
  S6: `${P}0b0000000006`,
  GONE: `${P}0b00000000ff`,
} as const;
type Name = keyof typeof ID;
const NAME = new Map<string, Name>((Object.entries(ID) as [Name, string][]).map(([name, id]) => [id, name]));
const nameOf = (id: string): string => NAME.get(id) ?? id;

const MATRIX: FixtureOptions = { fixture: "SR-125/matrix" };

/** A workspace file that lists a second repository, `vault`, which is not on this machine (SR-006). */
const WITH_VAULT =
  "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

const open = async (
  options: FixtureOptions = MATRIX,
  change?: (fixture: FixtureWorkspace) => Promise<void>,
): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  await change?.(fixture);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const matrix = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.matrix", input, { workspace })) as Output;

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<ListOutput> =>
  (await invoke("element.list", input, { workspace })) as ListOutput;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await matrix(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected trace.matrix to fail");
};

const STAGE_3 = { package: ID.P1 };
const rowIds = (output: Output): string[] => output.rows.map((r) => nameOf(r.id));
/** The columns as `kind/direction`. */
const columnKeys = (output: Output): string[] => output.columns.map((c) => `${c.kind}/${c.direction}`);
/** The cell of the row `row` in the column `column` (`kind/direction`), as the names of the other ends. */
const cell = (output: Output, row: Name, column: string): string[] => {
  const at = columnKeys(output).indexOf(column);
  const found = output.rows.find((r) => r.id === ID[row]);
  return (found?.cells[at] ?? ["<no cell>"]).map((l) => (typeof l === "string" ? l : nameOf(l.id)));
};

describe("trace.matrix rows", () => {
  it("[SR-125/AK1] gives one row per element of the selection, in the order element.list gives", async () => {
    const workspace = await open();
    const selections = [
      { selection: STAGE_3 },
      { selection: { filter: "Stage SRs" } },
      { selection: { filter: "Stage SRs" }, sort: [{ by: "title" }] },
      { selection: { filter: "Stage SRs" }, sort: [] },
      {
        selection: { package: ID.P1, where: { type: ["system-requirement"] } },
        sort: [{ by: "title", order: "desc" }],
      },
      { selection: { ids: [ID.S5, ID.S2, ID.N1, ID.S2] } },
      // The sort of the app's list when it has none of its own.
      {
        selection: {},
        sort: [
          { by: "type", order: "asc" },
          { by: "identifier", order: "asc" },
        ],
      },
      { selection: STAGE_3, limit: 2, offset: 1 },
      { selection: {}, limit: 3, offset: 4, sort: [{ by: "title" }] },
      {},
    ];
    for (const input of selections) {
      const [rows, elements] = [await matrix(workspace, input), await list(workspace, input)];
      expect(rows.rows.map((r) => [r.id, r.repository])).toEqual(
        elements.elements.map((e) => [e.id, e.repository]),
      );
      expect(rows.total).toBe(elements.total);
      expect(rows.incomplete).toBe(elements.incomplete);
      expect(rows.rows.map((r) => [r.shortId, r.type, r.title, r.file])).toEqual(
        elements.elements.map((e) => [e.shortId, e.type, e.title, e.file]),
      );
      expect(rows.rows.every((r) => r.depth === undefined)).toBe(true);
    }
    // The sort of the saved filter holds without `sort`, an empty `sort` is the order of the store.
    expect(rowIds(await matrix(workspace, { selection: { filter: "Stage SRs" } }))).toEqual([
      "S4",
      "S1",
      "S2",
      "S3",
      "S5",
    ]);
    expect(rowIds(await matrix(workspace, { selection: { filter: "Stage SRs" }, sort: [] }))).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
    ]);
    expect(rowIds(await matrix(workspace, { selection: { ids: [ID.S5, ID.S2, ID.N1, ID.S2] } }))).toEqual([
      "N1",
      "S2",
      "S5",
    ]);
  });

  it("[SR-125/AK1] sorted by hierarchy, the rows are the derivation tree with their depth", async () => {
    const workspace = await open();
    for (const input of [
      { selection: {}, sort: [{ by: "hierarchy" }] },
      { selection: STAGE_3, sort: [{ by: "hierarchy" }, { by: "title" }] },
      { selection: STAGE_3, sort: [{ by: "hierarchy" }], limit: 3, offset: 2 },
    ]) {
      const [rows, elements] = [await matrix(workspace, input), await list(workspace, input)];
      expect(rows.rows.map((r) => [r.id, r.repository, r.depth])).toEqual(
        (elements.tree ?? []).map((t) => [t.id, t.repository, t.depth]),
      );
      expect(rows.rows.map((r) => r.id)).toEqual(elements.elements.map((e) => e.id));
    }
    const tree = await matrix(workspace, { selection: STAGE_3, sort: [{ by: "hierarchy" }] });
    expect(tree.rows.map((r) => [nameOf(r.id), r.depth])).toEqual([
      ["S1", 0],
      ["S3", 1],
      ["S4", 1],
      ["S5", 1],
      ["S2", 0],
    ]);
  });

  it("gives one page of rows, with the columns and the total of the whole selection", async () => {
    const workspace = await open();
    const all = await matrix(workspace, { selection: STAGE_3 });
    const page = await matrix(workspace, { selection: STAGE_3, limit: 2, offset: 3 });
    expect(rowIds(page)).toEqual(rowIds(all).slice(3, 5));
    expect(page.rows.map((r) => r.cells)).toEqual(all.rows.slice(3, 5).map((r) => r.cells));
    expect(page.columns).toEqual(all.columns);
    expect(page.total).toBe(5);
    expect(rowIds(await matrix(workspace, { selection: STAGE_3, offset: 9 }))).toEqual([]);
  });

  it("describes each row as element.list describes its element", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: { ids: [ID.S1, ID.P1] } });
    const elements = await list(workspace, { selection: { ids: [ID.S1, ID.P1] } });
    expect(output.rows.map(({ cells: _cells, ...row }) => row)).toEqual(
      elements.elements.map((e) => ({
        id: e.id,
        repository: e.repository,
        shortId: e.shortId,
        type: e.type,
        status: e.status,
        title: e.title,
        file: e.file,
      })),
    );
  });
});

describe("trace.matrix columns and cells", () => {
  it("[SR-125/AK2] has a column per relation kind and direction that occurs, named by name and inverse name", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: STAGE_3 });
    // Relation kinds in the order of the metamodel; `excludes`, `replaces` and the others occur in no row.
    expect(output.columns.map((c) => [c.type, c.kind, c.direction, c.name, c.meaning])).toEqual([
      ["relation", "refines", "out", "Refines", "derivation"],
      ["relation", "refines", "in", "Refined by", "derivation"],
      ["relation", "derives-from", "out", "Derives from", "derivation"],
      ["relation", "derives-from", "in", "Derived by", "derivation"],
      ["relation", "based-on", "out", "Based on", undefined],
    ]);
    // Neither the package nor the validity makes a column unless named, nor an inline reference.
    expect(columnKeys(output)).not.toContain("packages/out");
    expect(output.rows.every((r) => r.cells.length === output.columns.length)).toBe(true);
    // A selection without these relations has no such column, and one without any has none.
    expect(columnKeys(await matrix(workspace, { selection: { ids: [ID.D1] } }))).toEqual(["based-on/in"]);
    expect(await matrix(workspace, { selection: { ids: [ID.P1] } })).toMatchObject({
      columns: [],
      rows: [{ id: ID.P1, cells: [] }],
      total: 1,
    });
  });

  it("[SR-125/AK2] names the other end of each relation with short ID and title", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: STAGE_3 });
    const element = await list(workspace, { selection: { ids: [ID.S1, ID.N1] } });
    const byId = new Map(element.elements.map((e) => [e.id, e]));
    const s1 = output.rows.find((r) => r.id === ID.S1);
    const [, , derivesFrom, derivedBy, basedOn] = s1?.cells ?? [];
    expect(derivesFrom).toMatchObject([
      {
        kind: "derives-from",
        meaning: "derivation",
        direction: "out",
        id: ID.N1,
        repository: "system",
        shortId: byId.get(ID.N1)?.shortId,
        title: "See the wind",
        accessible: true,
        targetState: "available",
        outdated: false,
      },
    ]);
    // Incoming: the source is the other end, in the order of the store.
    expect(derivedBy?.map((l) => [nameOf(l.id), l.direction, l.shortId, l.title, l.repository])).toEqual([
      ["S4", "in", expect.stringMatching(/^SR-/), "Warn of gusts", "system"],
      ["S5", "in", expect.stringMatching(/^SR-/), "Heat the sensor", "system"],
    ]);
    expect(basedOn).toMatchObject([{ kind: "based-on", id: ID.D1, title: "Use a cup anemometer" }]);
    expect(cell(output, "S2", "derives-from/out")).toEqual(["N1", "N2"]);
    expect(cell(output, "S3", "refines/out")).toEqual(["S1"]);
    expect(cell(output, "S1", "refines/in")).toEqual(["S3"]);
  });

  it("[SR-125/AK2] makes columns of the keys named in kinds, also of relation properties", async () => {
    const workspace = await open();
    const narrowed = await matrix(workspace, { selection: STAGE_3, kinds: ["derives-from"] });
    expect(columnKeys(narrowed)).toEqual(["derives-from/out", "derives-from/in"]);
    // Order of the output, not of the request.
    const both = await matrix(workspace, { selection: STAGE_3, kinds: ["packages", "based-on"] });
    expect(both.columns.map((c) => [c.kind, c.direction, c.name, c.property, c.meaning, c.count])).toEqual([
      ["based-on", "out", "Based on", undefined, undefined, 1],
      ["packages", "out", "Package", true, undefined, 5],
    ]);
    expect(cell(both, "S1", "packages/out")).toEqual(["P1"]);
    expect(both.rows[0]?.cells[1]).toMatchObject([{ kind: "packages", property: true, direction: "out" }]);
    // A package has the members as incoming relations, named as the property is.
    const members = await matrix(workspace, { selection: { ids: [ID.P1] }, kinds: ["packages"] });
    expect(members.columns).toMatchObject([{ kind: "packages", direction: "in", name: "Package", count: 1 }]);
    expect(cell(members, "P1", "packages/in")).toEqual(["S1", "S2", "S3", "S4", "S5"]);
  });

  it("names an incoming column after the name of its kind when the kind has no inverse name", async () => {
    const workspace = await open(MATRIX, async (fixture) => {
      const file = "metamodel/standard-model.yaml";
      const model = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(file, model.replace("    inverse-name: Basis for\n", ""));
    });
    const output = await matrix(workspace, { selection: { ids: [ID.D1] } });
    expect(output.columns).toMatchObject([{ kind: "based-on", direction: "in", name: "Based on" }]);
  });

  it("refuses a key that is no relation kind or relation property", async () => {
    const workspace = await open();
    const error = await failure(workspace, { selection: STAGE_3, kinds: ["derives-from", "nope", "title"] });
    expect(error.code).toBe("input.invalid");
    expect(error.details).toMatchObject({ fields: ["kinds"], unknown: ["nope", "title"] });
    expect((await failure(workspace, { selection: { filter: "no such filter" } })).code).toBe(
      "input.invalid",
    );
  });
});

describe("trace.matrix reads relations as the element view reads them", () => {
  /** A relation property that holds one target, and files whose relations have the wrong shape. */
  const IRREGULAR = async (fixture: FixtureWorkspace): Promise<void> => {
    const model = await fs.readFile(fixture.path("metamodel/standard-model.yaml"), "utf8");
    await fixture.write(
      "metamodel/standard-model.yaml",
      model.replace(
        "  - key: emergent\n",
        "  - key: owner\n    name: Owner\n    kind: relation\n    target-types: [need]\n  - key: emergent\n",
      ),
    );
    const edit = async (name: string, change: (text: string) => string): Promise<void> => {
      const file = `requirements/SR-0b00000000${name}.md`;
      await fixture.write(file, change(await fs.readFile(fixture.path(file), "utf8")));
    };
    // One target under a property with `many` false.
    await edit("01", (t) =>
      t.replace("packages:\n", `owner: { id: ${ID.N1}, version: n1:0000000000000000 }\npackages:\n`),
    );
    // A list where one target belongs, and one target where a list belongs.
    await edit("02", (t) => t.replace("packages:\n", `owner:\n  - { id: ${ID.N1} }\npackages:\n`));
    await edit("03", (t) => t.replace("refines:\n", `derives-from: { id: ${ID.N1} }\nrefines:\n`));
    // Items that name no target with a UUID.
    await edit("04", (t) =>
      t.replace(
        "derives-from:\n",
        "derives-from:\n  - just a text\n  - { id: not-a-uuid }\n  - { title: no id }\n",
      ),
    );
    // An element of a type without a title and a status.
    await fixture.write("packages/PKG-0e0000000003.md", `---\nid: ${P}0e0000000003\ntype: package\n---\n`);
  };

  it("leaves out items of the wrong shape and items without a UUID, and takes one target of a property", async () => {
    const workspace = await open(MATRIX, IRREGULAR);
    const output = await matrix(workspace, { selection: STAGE_3, kinds: ["owner", "derives-from"] });
    expect(columnKeys(output)).toEqual(["derives-from/out", "derives-from/in", "owner/out"]);
    expect(output.columns.map((c) => c.count)).toEqual([4, 1, 1]);
    expect(cell(output, "S1", "owner/out")).toEqual(["N1"]);
    expect(cell(output, "S2", "owner/out")).toEqual([]);
    expect(cell(output, "S3", "derives-from/out")).toEqual([]);
    expect(cell(output, "S4", "derives-from/out")).toEqual(["S1", "GONE"]);
    // The incoming relations of N1 under `owner`, a property.
    const need = await matrix(workspace, { selection: { ids: [ID.N1] }, kinds: ["owner"] });
    expect(cell(need, "N1", "owner/in")).toEqual(["S1"]);
  });

  it("describes an element without status and title with an empty title", async () => {
    const workspace = await open(MATRIX, IRREGULAR);
    const output = await matrix(workspace, { selection: { ids: [`${P}0e0000000003`] } });
    const [row] = output.rows;
    expect(row).toMatchObject({ type: "package", title: "", cells: [] });
    expect(row).not.toHaveProperty("status");
  });

  it("gives an empty title when the metamodel has no property with the meaning title", async () => {
    const workspace = await open(MATRIX, async (fixture) => {
      const file = "metamodel/standard-model.yaml";
      const model = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(file, model.replace("    meaning: title\n", ""));
    });
    const output = await matrix(workspace, { selection: { ids: [ID.S1] } });
    expect(output.rows[0]?.title).toBe("");
    const link = output.rows[0]?.cells[columnKeys(output).indexOf("derives-from/out")]?.[0];
    expect(link).toMatchObject({ id: ID.N1, targetState: "available" });
    expect(link).not.toHaveProperty("title");
  });
});

describe("trace.matrix gaps and counts", () => {
  it("[SR-125/AK3] leaves the cell of a row without such a relation empty", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: STAGE_3 });
    expect(cell(output, "S3", "derives-from/out")).toEqual([]);
    expect(cell(output, "S1", "refines/out")).toEqual([]);
    expect(cell(output, "S2", "derives-from/in")).toEqual([]);
    // A gap is an empty array, never a missing cell.
    for (const row of output.rows) {
      expect(row.cells).toHaveLength(output.columns.length);
    }
  });

  it("[SR-125/AK3] counts the rows of the whole selection with a relation of the column, as number and share", async () => {
    const workspace = await open();
    const expected = [
      ["refines", "out", 1, 0.2],
      ["refines", "in", 1, 0.2],
      ["derives-from", "out", 4, 0.8],
      ["derives-from", "in", 1, 0.2],
      ["based-on", "out", 1, 0.2],
    ];
    for (const page of [{}, { limit: 1 }, { limit: 2, offset: 4 }, { offset: 9 }]) {
      const output = await matrix(workspace, { selection: STAGE_3, ...page });
      expect(output.columns.map((c) => [c.kind, c.direction, c.count, c.share])).toEqual(expected);
      expect(output.total).toBe(5);
    }
    // The share is of the selection: with S6 and the needs, S6 derives from N1 as well.
    const wider = await matrix(workspace, { selection: { where: { type: ["system-requirement"] } } });
    expect(wider.total).toBe(6);
    expect(wider.columns.find((c) => c.kind === "derives-from" && c.direction === "out")).toMatchObject({
      count: 5,
      share: 5 / 6,
    });
  });

  it("[SR-125/AK3] counts a relation to a target that is not there, so its row is no gap", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: { ids: [ID.S4] } });
    expect(output.columns.map((c) => [c.kind, c.direction, c.count, c.share])).toEqual([
      ["derives-from", "out", 1, 1],
    ]);
  });

  it("[SR-125/AK3] counts and shows only the relations whose other end applies in a view", async () => {
    // S1 is valid for the variant only: in the core view it does not apply, so the relations to it are
    // left out; S5 derives only from S1 and is a gap there, and S4 keeps its relation to the missing target.
    const workspace = await open(MATRIX, async (fixture) => {
      const file = "requirements/SR-0b0000000001.md";
      const text = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(
        file,
        text.replace(
          "packages:\n",
          `validity:\n  - { id: ${ID.V1}, version: n1:0000000000000000 }\npackages:\n`,
        ),
      );
    });
    const plain = await matrix(workspace, { selection: STAGE_3 });
    const core = await matrix(workspace, { selection: { ...STAGE_3, view: "core" } });
    expect(rowIds(core)).toEqual(["S2", "S3", "S4", "S5"]);
    expect(rowIds(plain)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    expect(core.columns.map((c) => [c.kind, c.direction, c.count, c.share])).toEqual([
      ["derives-from", "out", 2, 0.5],
    ]);
    expect(cell(core, "S5", "derives-from/out")).toEqual([]);
    expect(cell(core, "S4", "derives-from/out")).toEqual(["GONE"]);
    expect(cell(core, "S2", "derives-from/out")).toEqual(["N1", "N2"]);
    // The refines of S3 pointed at S1: no column. In the variant S1 applies, the relations are back.
    const variant = await matrix(workspace, { selection: { ...STAGE_3, view: ID.V1 } });
    expect(rowIds(variant)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    expect(cell(variant, "S5", "derives-from/out")).toEqual(["S1"]);
    expect(cell(variant, "S1", "derives-from/in")).toEqual(["S4", "S5"]);
  });

  it("holds the view of a saved filter for the relations too", async () => {
    const workspace = await open(MATRIX, async (fixture) => {
      const file = "requirements/SR-0b0000000001.md";
      const text = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(
        file,
        text.replace(
          "packages:\n",
          `validity:\n  - { id: ${ID.V1}, version: n1:0000000000000000 }\npackages:\n`,
        ),
      );
      await fixture.write(
        "filters/core.yaml",
        "logreq-filter: 1\nname: Core stage\nview: core\nwhere: { package: PKG-000001 }\n",
      );
    });
    const output = await matrix(workspace, { selection: { filter: "Core stage" } });
    expect(rowIds(output)).toEqual(["S2", "S3", "S4", "S5"]);
    expect(cell(output, "S5", "derives-from/out")).toEqual([]);
    expect(output).toEqual(await matrix(workspace, { selection: { ...STAGE_3, view: "core" } }));
  });

  it("holds both views when a saved filter with a view and selection.view are given", async () => {
    const workspace = await open(MATRIX, async (fixture) => {
      const file = "requirements/SR-0b0000000001.md";
      const text = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(
        file,
        text.replace(
          "packages:\n",
          `validity:\n  - { id: ${ID.V1}, version: n1:0000000000000000 }\npackages:\n`,
        ),
      );
      await fixture.write(
        "filters/core.yaml",
        "logreq-filter: 1\nname: Core stage\nview: core\nwhere: { package: PKG-000001 }\n",
      );
    });
    // S1 applies in the variant but not in the core: a row must apply in both, and so must the other end of a link.
    const both = await matrix(workspace, { selection: { filter: "Core stage", view: ID.V1 } });
    expect(rowIds(both)).toEqual(["S2", "S3", "S4", "S5"]);
    expect(cell(both, "S5", "derives-from/out")).toEqual([]);
    expect(cell(both, "S4", "derives-from/out")).toEqual(["GONE"]);
    expect(both.columns.map((c) => [c.kind, c.direction, c.count])).toEqual([["derives-from", "out", 2]]);
    // The variant alone shows the relations to S1.
    const variant = await matrix(workspace, { selection: { ...STAGE_3, view: ID.V1 } });
    expect(cell(variant, "S5", "derives-from/out")).toEqual(["S1"]);
  });
});

describe("trace.matrix outdated and missing relations", () => {
  it("[SR-125/AK4] marks a relation to an older version of its target as outdated, with both versions", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: STAGE_3, kinds: ["derives-from"] });
    const [s1, s2] = [output.rows.find((r) => r.id === ID.S1), output.rows.find((r) => r.id === ID.S2)];
    const current = (await list(workspace, { selection: { ids: [ID.N1] } })).elements[0]?.version;
    expect(current).toMatch(/^n1:/);
    expect(s1?.cells[0]).toMatchObject([
      { id: ID.N1, storedVersion: current, currentVersion: current, outdated: false },
    ]);
    expect(s2?.cells[0]).toMatchObject([
      { id: ID.N1, storedVersion: "n1:0000000000000000", currentVersion: current, outdated: true },
      { id: ID.N2, outdated: false },
    ]);
  });

  it("[SR-125/AK4] marks an incoming relation from a source that stores an older version of the row", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: { ids: [ID.S1] }, kinds: ["derives-from"] });
    const current = (await list(workspace, { selection: { ids: [ID.S1] } })).elements[0]?.version;
    expect(
      output.rows[0]?.cells[1]?.map((l) => [nameOf(l.id), l.outdated, l.storedVersion, l.currentVersion]),
    ).toEqual([
      ["S4", false, current, current],
      ["S5", true, "n1:0000000000000000", current],
    ]);
  });

  it("[SR-125/AK4] marks a relation to a target that is not there as missing, and counts it", async () => {
    const workspace = await open();
    const output = await matrix(workspace, { selection: { ids: [ID.S4] } });
    const [link] = output.rows[0]?.cells[0]?.slice(1) ?? [];
    expect(link).toEqual({
      kind: "derives-from",
      meaning: "derivation",
      direction: "out",
      id: ID.GONE,
      repository: "system",
      accessible: false,
      targetState: "missing",
      storedVersion: "n1:0000000000000000",
      outdated: false,
    });
    expect(output.rows[0]?.cells[0]?.map((l) => [nameOf(l.id), l.targetState, l.outdated])).toEqual([
      ["S1", "available", false],
      ["GONE", "missing", false],
    ]);
  });

  it("[SR-125/AK4] shows a target in a repository that is not here and marks the matrix incomplete", async () => {
    const workspace = await open({
      ...MATRIX,
      files: {
        "logreq-workspace.yaml": WITH_VAULT,
        "requirements/SR-0b0000000003.md": (
          await fs.readFile(
            path.join(
              import.meta.dirname,
              "../../../../../fixtures/SR-125/matrix/requirements/SR-0b0000000003.md",
            ),
            "utf8",
          )
        ).replace(
          "refines:\n",
          `derives-from:\n  - { id: ${P}0a00000000ff, version: n1:0000000000000000, repository: vault }\nrefines:\n`,
        ),
      },
    });
    const output = await matrix(workspace, { selection: { ids: [ID.S3] } });
    expect(output.incomplete).toBe(true);
    const [link] = output.rows[0]?.cells[output.columns.findIndex((c) => c.kind === "derives-from")] ?? [];
    expect(link).toMatchObject({
      id: `${P}0a00000000ff`,
      repository: "vault",
      shortId: "UNKNOWN-0000ff",
      accessible: false,
      targetState: "inaccessible",
      outdated: false,
    });
    expect((await matrix(await open(), { selection: STAGE_3 })).incomplete).toBe(false);
  });

  it("shows a relation to a repository the workspace file does not list as unknown", async () => {
    const workspace = await open(MATRIX, async (fixture) => {
      const file = "requirements/SR-0b0000000003.md";
      const text = await fs.readFile(fixture.path(file), "utf8");
      await fixture.write(
        file,
        text.replace(
          "refines:\n",
          `derives-from:\n  - { id: ${P}0a00000000ff, repository: elsewhere }\nrefines:\n`,
        ),
      );
    });
    const output = await matrix(workspace, { selection: { ids: [ID.S3] } });
    const [link] = output.rows[0]?.cells[output.columns.findIndex((c) => c.kind === "derives-from")] ?? [];
    expect(link).toMatchObject({
      repository: "elsewhere",
      targetState: "unknown-repository",
      accessible: false,
    });
  });

  it("gives no incoming relations to an element whose UUID several files of its repository share", async () => {
    const workspace = await open(MATRIX, async (fixture) => {
      const text = await fs.readFile(fixture.path("requirements/SR-0b0000000001.md"), "utf8");
      await fixture.write("requirements/SR-copy.md", text);
    });
    const output = await matrix(workspace, { selection: STAGE_3 });
    expect(output.rows.map((r) => nameOf(r.id))).toEqual(["S1", "S2", "S3", "S4", "S5", "S1"]);
    // No "Refined by" or "Derived by": S3, S4 and S5 point at an element that is not one.
    expect(columnKeys(output)).toEqual(["refines/out", "derives-from/out", "based-on/out"]);
    // The relations from the sources are `ambiguous` from the other side: the sources show it.
    const sources = await matrix(workspace, { selection: { ids: [ID.S4] }, kinds: ["derives-from"] });
    expect(sources.rows[0]?.cells[0]?.map((l) => [nameOf(l.id), l.targetState, l.accessible])).toEqual([
      ["S1", "ambiguous", false],
      ["GONE", "missing", false],
    ]);
  });
});

describe("trace.matrix selections", () => {
  it("[SR-125/AK6] gives the same matrix for a package given as selection.package or as a condition", async () => {
    const workspace = await open();
    const byPackage = await matrix(workspace, { selection: { package: ID.P1 } });
    expect(await matrix(workspace, { selection: { where: { package: ID.P1 } } })).toEqual(byPackage);
    expect(await matrix(workspace, { selection: { package: "PKG-000001" } })).toEqual(byPackage);
    expect(await matrix(workspace, { selection: { package: ID.P1 }, sort: [] })).toEqual(byPackage);
    const stage = await matrix(workspace, { selection: { filter: "Stage SRs" } });
    expect(new Set(rowIds(stage))).toEqual(new Set(rowIds(byPackage)));
    const ids = await matrix(workspace, { selection: { ids: [ID.S3, ID.S1] } });
    expect(rowIds(ids)).toEqual(["S1", "S3"]);
    expect(ids.columns.map((c) => [c.kind, c.direction, c.count, c.share])).toEqual([
      ["refines", "out", 1, 0.5],
      ["refines", "in", 1, 0.5],
      ["derives-from", "out", 1, 0.5],
      ["derives-from", "in", 1, 0.5],
      ["based-on", "out", 1, 0.5],
    ]);
  });

  it("is incomplete while the workspace file lists a repository that is not on this machine", async () => {
    const workspace = await open({ ...MATRIX, files: { "logreq-workspace.yaml": WITH_VAULT } });
    expect((await matrix(workspace, { selection: STAGE_3 })).incomplete).toBe(true);
    expect((await matrix(workspace, { selection: { ids: [ID.D1] } })).incomplete).toBe(true);
  });
});
