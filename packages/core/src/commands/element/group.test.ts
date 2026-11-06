// element.list grouped (SR-149) on fixtures/SR-149/group, one repository `system` with the standard
// model and a choice property `area` that holds a list (metamodel/area.yaml):
// - need a1 "See the wind" (approved);
// - packages d1 "Wind" and d2 "alarms" (approved), so that the title order (ignoring case) is d2, d1;
// - SR b1 "Measure wind speed" (draft, functional, area [sensor, display]): in d1 and d2, derives from a1;
// - SR b2 "Show the wind" (approved, performance, area "Display", the display name): in d1;
// - SR b3 "Average the wind" (draft, requirement type "custom", no choice, no area): its only package
//   d9 is not in the workspace; derives from b1;
// - SR b4 "Alarm on storms" (obsolete, quality, area [display]): in d2, derives from b1.
// Store order: a1, d1, d2, b1, b2, b3, b4.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { FACET_MAX_VALUES } from "../../query/facets.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

type Output = FullList;

const P = "14914914-0000-4000-8000-0000000000";
const id = (tail: string): string => `${P}${tail}`;
const [A1, D1, B1, B2, B3, B4] = ["a1", "d1", "b1", "b2", "b3", "b4"].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
];

const GROUP: FixtureOptions = { fixture: "SR-149/group" };
const BY_TITLE = [{ by: "title" }];

const open = async (options: FixtureOptions = GROUP): Promise<{ workspace: Workspace; root: string }> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, root: fixture.root };
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.list", input, { workspace })) as Output;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  const error = await list(workspace, input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** The groups as `heading: elements` lines, the elements named by the tail of their UUID. */
const groupLines = (output: Output): string[] =>
  (output.groups ?? []).map((group) => {
    const start = group.offset - (output.offset ?? 0);
    const rows = output.elements.slice(start, start + group.count);
    const head = group.value === undefined ? "-" : String(group.value);
    return `${head}: ${rows.map((e) => e.id.slice(P.length)).join(" ")}`;
  });

const filesOf = async (root: string): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      files.set(path.relative(root, file), (await fs.readFile(file)).toString("base64"));
    }
  }
  return files;
};

describe("element.list grouped (SR-149 AK1)", () => {
  it("[SR-149/AK1] groups by status in metamodel order, each heading with its value, name and count", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { group: "status", sort: BY_TITLE });
    expect(output.groups).toEqual([
      { value: "draft", name: "Draft", count: 2, offset: 0 },
      { value: "approved", name: "Approved", count: 4, offset: 2 },
      { value: "obsolete", name: "Obsolete", count: 1, offset: 6 },
    ]);
    expect(groupLines(output)).toEqual(["draft: b3 b1", "approved: d2 a1 b2 d1", "obsolete: b4"]);
    expect([output.rows, output.total, output.offset]).toEqual([7, 7, 0]);
  });

  it("[SR-149/AK1] groups by a choice property: choices in metamodel order, other values after them, no value last", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { group: "requirement-type", sort: BY_TITLE });
    expect(output.groups?.map((g) => [g.value, g.name, g.count])).toEqual([
      ["functional", "Functional", 1],
      ["quality", "Quality", 1],
      ["performance", "Performance", 1],
      ["custom", undefined, 1],
      [undefined, undefined, 3],
    ]);
    expect(groupLines(output).at(-1)).toBe("-: d2 a1 d1");
  });

  it("[SR-149/AK1] groups by type in metamodel order, a subtype as a group of its own", async () => {
    const { workspace } = await open({
      ...GROUP,
      files: {
        "metamodel/software.yaml":
          "reqseq-metamodel: 1\ntypes:\n  - { key: software-requirement, name: Software Requirement, prefix: SWR, extends: system-requirement }\n",
        "requirements/SWR-0000000000f1.md": `---\nid: ${id("f1")}\ntype: software-requirement\nstatus: draft\ntitle: Filter\n---\n`,
        "requirements/X-0000000000f2.md": `---\nid: ${id("f2")}\ntype: gadget\ntitle: Gadget\n---\n`,
      },
    });
    const output = await list(workspace, { group: "type" });
    expect(output.groups?.map((g) => [g.value, g.name, g.count])).toEqual([
      ["software-requirement", "Software Requirement", 1],
      ["need", "Need", 1],
      ["system-requirement", "System Requirement", 4],
      ["package", "Package", 2],
      // A type the metamodel does not know comes after the known ones, by its key.
      ["gadget", undefined, 1],
    ]);
  });

  it("[SR-149/AK1] groups by package by title ignoring case, the elements without an available package last", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { group: "package", sort: BY_TITLE });
    expect(output.groups).toEqual([
      { value: "PKG-0000d2", title: "alarms", count: 2, offset: 0 },
      { value: "PKG-0000d1", title: "Wind", count: 2, offset: 2 },
      // b3 names only d9, which is not in the workspace.
      { unavailable: 1, count: 4, offset: 4 },
    ]);
    // b3 names only the package d9, which is not in the workspace (spec-frage #978).
    expect(groupLines(output)).toEqual(["PKG-0000d2: b4 b1", "PKG-0000d1: b1 b2", "-: d2 b3 a1 d1"]);
  });

  it("puts a choice written by its display name in the group of that choice", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { group: "area", sort: BY_TITLE });
    expect(groupLines(output)).toEqual(["sensor: b1", "display: b4 b1 b2", "-: d2 b3 a1 d1"]);
    expect(output.groups?.[1]).toEqual({ value: "display", name: "Display", count: 3, offset: 1 });
  });

  it("orders other values of a choice property as the sort does: numbers, texts, booleans; ignores mappings", async () => {
    const { workspace } = await open({
      ...GROUP,
      files: {
        "requirements/SR-0000000000b5.md": `---\nid: ${id("b5")}\ntype: system-requirement\ntitle: Odd\narea: [true, other, 3, { a: 1 }, .nan, Other, sensor, other]\npackages: [d1]\n---\n`,
      },
    });
    const output = await list(workspace, { group: "area", selection: { ids: [id("b5")] } });
    expect(output.groups?.map((g) => g.value)).toEqual(["sensor", 3, "Other", "other", true]);
    // An element without status is in no status group but the last; a package item without an ID
    // names no element, so b5 has no package and none that is unavailable.
    expect((await list(workspace, { group: "status", selection: { ids: [id("b5")] } })).groups).toEqual([
      { count: 1, offset: 0 },
    ]);
    expect((await list(workspace, { group: "package", selection: { ids: [id("b5")] } })).groups).toEqual([
      { count: 1, offset: 0 },
    ]);
  });

  it("orders an untitled package by its short ID, as element.facets does", async () => {
    const { workspace } = await open({
      ...GROUP,
      files: {
        "packages/PKG-0000000000d3.md": `---\nid: ${id("d3")}\ntype: package\nstatus: approved\n---\n`,
        "requirements/SR-0000000000b5.md": `---\nid: ${id("b5")}\ntype: system-requirement\ntitle: Odd\npackages:\n  - { id: ${id("d3")} }\n  - { id: ${D1} }\n---\n`,
      },
    });
    const output = await list(workspace, { group: "package", selection: { ids: [id("b5")] } });
    expect(output.groups).toEqual([
      { value: "PKG-0000d3", count: 1, offset: 0 },
      { value: "PKG-0000d1", title: "Wind", count: 1, offset: 1 },
    ]);
  });

  it("gives no group for an empty list", async () => {
    const { workspace } = await open();
    const where = { status: ["nothing"] };
    expect(await list(workspace, { group: "status", selection: { where } })).toMatchObject({
      elements: [],
      groups: [],
      rows: 0,
      total: 0,
    });
    const tree = await list(workspace, {
      group: "status",
      selection: { where },
      sort: [{ by: "hierarchy" }],
    });
    expect(tree.tree).toEqual([]);
  });
});

describe("element.list grouped by a property with few shared values (SR-149 AK1)", () => {
  /** SR-069/filter: b1 topic Wind, b2 Timing; b6 Timing and b7 [Wind, Timing] make the topics shared. */
  const TOPICS: FixtureOptions = {
    fixture: "SR-069/filter",
    files: {
      "requirements/SR-0000000000b6.md":
        "---\nid: 69069069-0000-4000-8000-0000000000b6\ntype: system-requirement\nstatus: draft\ntitle: Measure the rain\ntopic: Timing\n---\n",
      "requirements/SR-0000000000b7.md":
        "---\nid: 69069069-0000-4000-8000-0000000000b7\ntype: system-requirement\nstatus: approved\ntitle: Measure the hail\ntopic: [Wind, Timing]\n---\n",
    },
  };
  const short = (output: Output): string[] =>
    (output.groups ?? []).map(
      (g) =>
        `${g.value === undefined ? "-" : String(g.value)}: ${output.elements
          .slice(g.offset, g.offset + g.count)
          .map((e) => e.shortId)
          .join(" ")}`,
    );

  it("[SR-149/AK1] groups by topic, a text property element.facets offers values of, in text order", async () => {
    const { workspace } = await open(TOPICS);
    const output = await list(workspace, {
      group: "topic",
      selection: { where: { type: ["system-requirement"], subtypes: false } },
      sort: BY_TITLE,
    });
    expect(short(output)).toEqual([
      "Timing: SR-0000b2 SR-0000b7 SR-0000b6",
      "Wind: SR-0000b7 SR-0000b1",
      "-: SR-0000b5 SR-0000b4 SR-0000b3",
    ]);
    expect(output.groups?.map((g) => g.count)).toEqual([3, 2, 3]);
  });

  it("groups by a relation property as by package: validity by variant", async () => {
    const { workspace } = await open(TOPICS);
    const output = await list(workspace, {
      group: "validity",
      selection: { where: { type: ["system-requirement"], subtypes: false } },
    });
    expect(output.groups?.map((g) => [g.value, g.title, g.count])).toEqual([
      ["VAR-0000c1", "Coastal", 1],
      ["VAR-0000c2", "Mountain", 1],
      [undefined, undefined, 5],
    ]);
    const packages = await list(workspace, { group: "packages" });
    expect(packages.groups).toEqual((await list(workspace, { group: "package" })).groups);
  });

  it("takes the threshold of element.facets from its schema default", async () => {
    const schema = JSON.parse(
      await fs.readFile(
        new URL("../../../../../schemas/commands/element.facets.json", import.meta.url),
        "utf8",
      ),
    ) as { input: { properties: { maxValues: { default: number } } } };
    expect(FACET_MAX_VALUES).toBe(schema.input.properties.maxValues.default);
  });

  it("reads a relation property as element.facets and eq do, also a single mapping where a list is expected", async () => {
    const { workspace } = await open({
      ...TOPICS,
      files: {
        ...TOPICS.files,
        "requirements/SR-0000000000b8.md":
          "---\nid: 69069069-0000-4000-8000-0000000000b8\ntype: system-requirement\nstatus: draft\ntitle: One variant\nvalidity: { id: 69069069-0000-4000-8000-0000000000c1 }\n---\n",
      },
    });
    const selection = { where: { type: ["system-requirement"], subtypes: false } };
    const output = await list(workspace, { group: "validity", selection, sort: BY_TITLE });
    const first = output.groups?.[0];
    expect([first?.value, first?.count]).toEqual(["VAR-0000c1", 2]);
    const members = output.elements.slice(0, 2).map((e) => e.shortId);
    const selected = await list(workspace, {
      selection: {
        where: { all: [selection.where, { property: "validity", op: "eq", value: "VAR-0000c1" }] },
      },
      sort: BY_TITLE,
    });
    expect(selected.elements.map((e) => e.shortId)).toEqual(members);
    const facets = (await invoke(
      "element.facets",
      { selection },
      { workspace },
    )) as CommandOutput<"element.facets">;
    const validity = facets.properties.find((p) => p.key === "validity");
    expect(validity?.values?.find((v) => v.value === "VAR-0000c1")?.count).toBe(2);
  });

  it("counts a target in a repository that is not on this machine as unavailable", async () => {
    const PACKAGE = "7e3a5c9b-1d2f-4e6a-8b0c-2d4e6f8a0b1c";
    const member = (tail: string, items: string): string =>
      `---\nid: 8f1e3d5c-7b9a-4c2e-a4f6-0000000000${tail}\ntype: system-requirement\nstatus: draft\ntitle: Member ${tail}\npackages:\n${items}---\n`;
    const fixture = await createFixtureWorkspace({
      fixture: "SR-005/cross-repository",
      files: {
        "system/requirements/SR-0000000000e1.md": member(
          "e1",
          `  - { id: ${PACKAGE}, repository: platform }\n`,
        ),
        // A free name (D-020) names no element: no package, none unavailable.
        "system/requirements/SR-0000000000e2.md": member("e2", "  - Platform 2.0\n"),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const there = new Workspace(fixture.path("system"));
    onTestFinished(() => there.close());
    const where = { type: ["system-requirement"] };
    expect((await list(there, { group: "package", selection: { where } })).groups).toEqual([
      { value: "PKG-8a0b1c", title: "Platform 2.0", count: 1, offset: 0 },
      { count: 2, offset: 1 },
    ]);
    await fs.rm(fixture.path("platform-checkout"), { recursive: true });
    const away = new Workspace(fixture.path("system"));
    onTestFinished(() => away.close());
    const output = await list(away, { group: "package", selection: { where } });
    expect(output.groups).toEqual([{ unavailable: 1, count: 3, offset: 0 }]);
    expect(output.incomplete).toBe(true);
  });

  it("refuses topic where no topic is shared, as element.facets offers none", async () => {
    const { workspace } = await open({ fixture: "SR-069/filter" });
    const error = await failure(workspace, { group: "topic" });
    expect(error.details?.["fields"]).toEqual(["group"]);
  });
});

describe("element.list grouped with several values (SR-149 AK2)", () => {
  it("[SR-149/AK2] lists an element with several packages or values in each of their groups", async () => {
    const { workspace } = await open();
    const packages = await list(workspace, { group: "package", sort: BY_TITLE });
    expect(packages.elements.filter((e) => e.id === B1)).toHaveLength(2);
    const area = await list(workspace, { group: "area", sort: BY_TITLE });
    expect(area.elements.filter((e) => e.id === B1)).toHaveLength(2);
    expect([packages.rows, area.rows, area.total]).toEqual([8, 8, 7]);
  });

  it("[SR-149/AK2] gives both rows of an element on one page, each the whole element", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { group: "package", sort: BY_TITLE, offset: 1, limit: 2 });
    expect(output.elements.map((e) => e.id)).toEqual([B1, B1]);
    expect(output.elements[0]).toEqual(output.elements[1]);
    expect(output.elements[0]?.title).toBe("Measure wind speed");
    // The headings cover the whole list; the page starts at row 1.
    expect([output.offset, output.groups?.length, output.rows]).toEqual([1, 3, 8]);
  });
});

describe("element.list regrouped (SR-149 AK3)", () => {
  it("[SR-149/AK3] another grouping, or none, gives the same elements with the same filter and the same order in each group", async () => {
    const { workspace } = await open();
    const selection = { where: { type: ["system-requirement", "need"] } };
    const sort = [{ by: "status" }, { by: "title", order: "desc" }];
    const plain = (await list(workspace, { selection, sort })).elements.map((e) => e.id);
    expect(plain).toEqual([B1, B3, B2, A1, B4]);
    for (const group of ["requirement-type", "package", "area", "type"]) {
      const output = await list(workspace, { selection, sort, group });
      const ids = output.elements.map((e) => e.id);
      expect(new Set(ids)).toEqual(new Set(plain));
      for (const { offset, count } of output.groups ?? []) {
        const members = ids.slice(offset, offset + count);
        expect(members).toEqual(plain.filter((e) => members.includes(e)));
      }
    }
  });

  it("[SR-149/AK3] keeps the sort of a saved filter inside the groups", async () => {
    const { workspace } = await open({
      ...GROUP,
      files: {
        "filters/requirements.yaml":
          "reqseq-filter: 1\nname: Requirements\nwhere: { type: [system-requirement] }\nsort: [{ by: title }]\n",
      },
    });
    const output = await list(workspace, { selection: { filter: "Requirements" }, group: "package" });
    expect(groupLines(output)).toEqual(["PKG-0000d2: b4 b1", "PKG-0000d1: b1 b2", "-: b3"]);
  });

  it("makes each group its own derivation tree under hierarchy", async () => {
    const { workspace } = await open();
    const output = await list(workspace, { group: "area", sort: [{ by: "hierarchy" }, { by: "title" }] });
    expect(groupLines(output)).toEqual(["sensor: b1", "display: b1 b4 b2", "-: d2 b3 a1 d1"]);
    expect(output.tree?.map((p) => [p.id.slice(P.length), p.depth, p.parent?.id.slice(P.length)])).toEqual([
      ["b1", 0, undefined],
      ["b1", 0, undefined],
      ["b4", 1, "b1"],
      ["b2", 0, undefined],
      ["d2", 0, undefined],
      // b1, its parent, is in another group: here b3 is a root.
      ["b3", 0, undefined],
      ["a1", 0, undefined],
      ["d1", 0, undefined],
    ]);
    const page = await list(workspace, { group: "area", sort: [{ by: "hierarchy" }], offset: 2, limit: 2 });
    expect(page.tree?.map((p) => p.id)).toEqual(page.elements.map((e) => e.id));
  });
});

describe("element.list grouping writes nothing (SR-149 AK5)", () => {
  it("[SR-149/AK5] choosing and changing a grouping changes no file", async () => {
    const { workspace, root } = await open();
    const before = await filesOf(root);
    for (const group of ["status", "package", "area", "type"]) {
      await list(workspace, { group, sort: BY_TITLE, withText: true });
    }
    await list(workspace, { sort: BY_TITLE });
    expect(await filesOf(root)).toEqual(before);
  });
});

describe("element.list group refusals", () => {
  it("refuses free text without shared values, unknown keys and relation kinds", async () => {
    const { workspace } = await open();
    for (const group of ["title", "acceptance-criteria", "topic", "nothing", "derives-from"]) {
      const error = await failure(workspace, { group });
      expect([error.code, error.details?.["fields"]]).toEqual(["input.invalid", ["group"]]);
    }
    expect((await failure(workspace, { group: "derives-from" })).message).toContain(
      "derives-from is a relation kind, not a property",
    );
  });

  it("checks a sort by hierarchy as without groups", async () => {
    const { workspace } = await open();
    const desc = await failure(workspace, { group: "status", sort: [{ by: "hierarchy", order: "desc" }] });
    expect(desc.details?.["fields"]).toEqual(["sort[0].order"]);
    const second = await failure(workspace, {
      group: "status",
      sort: [{ by: "title" }, { by: "hierarchy" }],
    });
    expect(second.details?.["fields"]).toEqual(["sort[1].by"]);
  });

  it("refuses package when no property has the meaning packages (SR-013 AK3)", async () => {
    const bare =
      "reqseq-metamodel: 1\ntypes:\n  - { key: need, name: Need, prefix: N, properties: [title] }\nproperties:\n" +
      "  - { key: title, name: Title, kind: text, meaning: title }\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n";
    const { workspace } = await open({
      ...GROUP,
      files: { "metamodel/standard-model.yaml": bare, "metamodel/area.yaml": "reqseq-metamodel: 1\n" },
    });
    const error = await failure(workspace, { group: "package" });
    expect([error.code, error.details?.["meaning"]]).toEqual(["metamodel.meaning-unassigned", "packages"]);
  });
});
