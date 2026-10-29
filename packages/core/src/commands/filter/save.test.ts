// filter.save (SR-070 AK1) on fixtures/SR-069/filter (see commands/element/list.test.ts for its
// elements): needs N-0000a1 and N-0000a2, variants VAR-0000c1 and VAR-0000c2, packages PKG-0000d1 and
// PKG-0000d2, system requirements SR-0000b1 to SR-0000b5, software requirements SWR-0000f1, SWR-0000f2.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { fileSchemaValidator } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Saved = CommandOutput<"filter.save">;
type Listed = CommandOutput<"filter.list">;

const P = "69069069-0000-4000-8000-0000000000";

const open = async (
  options: FixtureOptions = { fixture: "SR-069/filter" },
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const save = async (workspace: Workspace, input: Record<string, unknown>): Promise<Saved> =>
  (await invoke("filter.save", input, { workspace })) as Saved;

const listed = async (workspace: Workspace): Promise<Listed> =>
  (await invoke("filter.list", {}, { workspace })) as Listed;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await save(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("filter.save did not fail");
};

const read = (fixture: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(fixture.path(file), "utf8");

describe("filter.save (SR-070)", () => {
  it("[SR-070/AK1] saves a filter with its name as a YAML file in the filters folder of the repository", async () => {
    const { fixture, workspace } = await open();
    const out = await save(workspace, {
      name: "Draft requirements",
      description: "What is still open",
      where: { all: [{ type: ["system-requirement"] }, { status: ["draft"] }] },
      sort: [{ by: "title" }],
    });
    expect(out).toEqual({ files: ["filters/draft-requirements.yaml"], problems: [] });
    const text = await read(fixture, "filters/draft-requirements.yaml");
    expect(text).toBe(
      [
        "reqseq-filter: 1",
        "name: Draft requirements",
        "description: What is still open",
        "where:",
        "  all:",
        "    - type: [system-requirement]",
        "    - status: [draft]",
        "sort:",
        "  - by: title",
        "    order: asc",
        "",
      ].join("\n"),
    );
    // A file of the format of filter.schema.json, which every working copy reads (AK2).
    expect(fileSchemaValidator("filter.schema.json")(parse(text))).toBe(true);
    expect((await listed(workspace)).filters).toEqual([
      {
        name: "Draft requirements",
        file: "filters/draft-requirements.yaml",
        description: "What is still open",
        where: { all: [{ type: ["system-requirement"] }, { status: ["draft"] }] },
        sort: [{ by: "title", order: "asc" }],
      },
    ]);
  });

  it("[SR-070/AK1] writes element references as UUIDs and choices by key (product owner's note on #82)", async () => {
    const { fixture, workspace } = await open();
    await save(workspace, {
      name: "Coastal sensors",
      view: "var-0000C1",
      where: {
        all: [
          { package: "pkg-0000d1" },
          { validFor: "VAR-0000c1" },
          { not: { validFor: "core" } },
          { property: "packages", op: "in", value: ["PKG-0000d2", "PKG-0000d1"] },
          { property: "derives-from", op: "eq", value: "N-0000a1" },
          { property: "requirement-type", op: "eq", value: "Performance" },
          { property: "requirement-type", op: "in", value: ["functional", "nope", 3] },
          { property: "requirement-type", op: "contains", value: "Perf" },
          { property: "requirement-type", op: "ne", value: 3 },
          { property: "topic", op: "eq", value: "Timing" },
          { property: "owner", op: "in", value: ["Dana"] },
          {
            relation: { meaning: "derivation", direction: "up", to: { package: "PKG-0000d1" } },
            exists: true,
          },
          { relation: { meaning: "derivation", direction: "down" }, exists: false },
          { any: [{ verification: ["open"], variant: "VAR-0000c2" }, { verification: ["open"] }] },
        ],
      },
    });
    expect(parse(await read(fixture, "filters/coastal-sensors.yaml"))).toEqual({
      "reqseq-filter": 1,
      name: "Coastal sensors",
      view: `${P}c1`,
      where: {
        all: [
          { package: `${P}d1` },
          { validFor: `${P}c1` },
          { not: { validFor: "core" } },
          { property: "packages", op: "in", value: [`${P}d2`, `${P}d1`] },
          { property: "derives-from", op: "eq", value: `${P}a1` },
          { property: "requirement-type", op: "eq", value: "performance" },
          { property: "requirement-type", op: "in", value: ["functional", "nope", 3] },
          { property: "requirement-type", op: "contains", value: "Perf" },
          { property: "requirement-type", op: "ne", value: 3 },
          { property: "topic", op: "eq", value: "Timing" },
          { property: "owner", op: "in", value: ["Dana"] },
          { relation: { meaning: "derivation", direction: "up", to: { package: `${P}d1` } }, exists: true },
          { relation: { meaning: "derivation", direction: "down" }, exists: false },
          { any: [{ verification: ["open"], variant: `${P}c2` }, { verification: ["open"] }] },
        ],
      },
    });
  });

  it("[SR-070/AK1] saves under an existing name, in any case, into its file and changes only what changed (#363)", async () => {
    const hand = [
      "# Kept by the team",
      "reqseq-filter: 1",
      "name: Drafts   # as the app shows it",
      "",
      "where:",
      "  status: [draft]   # only drafts",
      "# Order of the list",
      "sort:",
      "  - { by: title }",
      "",
    ].join("\n");
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: { "filters/mine.yaml": hand },
    });
    // The same definition (`order` filled in by the input, absent in the file): nothing to write.
    expect(
      await save(workspace, { name: "Drafts", where: { status: ["draft"] }, sort: [{ by: "title" }] }),
    ).toEqual({
      files: [],
      problems: [],
    });
    expect(await read(fixture, "filters/mine.yaml")).toBe(hand);
    // The name in another case is the same filter; only its line changes.
    expect(
      await save(workspace, { name: "drafts", where: { status: ["draft"] }, sort: [{ by: "title" }] }),
    ).toEqual({
      files: ["filters/mine.yaml"],
      problems: [],
    });
    expect(await read(fixture, "filters/mine.yaml")).toBe(
      hand.replace("name: Drafts   # as the app shows it", "name: drafts"),
    );
    // A new condition and a description: the lines of `where` change, `description` is appended.
    await save(workspace, {
      name: "Drafts",
      description: "Open work",
      where: { status: ["draft", "obsolete"] },
      sort: [{ by: "title", order: "asc" }],
    });
    expect(await read(fixture, "filters/mine.yaml")).toBe(
      [
        "# Kept by the team",
        "reqseq-filter: 1",
        "name: Drafts",
        "",
        "where:",
        "  status: [draft, obsolete]",
        "# Order of the list",
        "sort:",
        "  - { by: title }",
        "description: Open work",
        "",
      ].join("\n"),
    );
    // What the input leaves out is removed from the file; the file stays, nothing else is written.
    expect(await save(workspace, { name: "DRAFTS", where: { status: ["draft", "obsolete"] } })).toEqual({
      files: ["filters/mine.yaml"],
      problems: [],
    });
    expect(await read(fixture, "filters/mine.yaml")).toBe(
      "# Kept by the team\nreqseq-filter: 1\nname: DRAFTS\n\nwhere:\n  status: [draft, obsolete]\n# Order of the list\n",
    );
    expect(await fs.readdir(fixture.path("filters"))).toEqual(["mine.yaml"]);
  });

  it("[SR-070/AK1] gives a new filter a file name of its own", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "filters/Open.yaml": "not a filter: true\n",
        "filters/OPEN-2.yaml": "",
        "filters/open-3.txt": "",
      },
    });
    expect((await save(workspace, { name: "Open!", where: { all: [] } })).files).toEqual([
      "filters/open-3.yaml",
    ]);
    expect((await save(workspace, { name: "Offene Prüfungen (Größe)", where: { all: [] } })).files).toEqual([
      "filters/offene-prufungen-große.yaml",
    ]);
    expect((await save(workspace, { name: "NUL", where: { all: [] } })).files).toEqual([
      "filters/nul-filter.yaml",
    ]);
    expect((await save(workspace, { name: "???", where: { all: [] } })).files).toEqual([
      "filters/filter.yaml",
    ]);
    const long = (await save(workspace, { name: `${"a".repeat(63)} b c`, where: { all: [] } })).files;
    expect(long).toEqual([`filters/${"a".repeat(63)}.yaml`]);
    expect(await fs.readFile(fixture.path("filters/Open.yaml"), "utf8")).toBe("not a filter: true\n");
  });

  it("[SR-070/AK1] writes into the filters location of the workspace file, creating its folders", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          "metamodel: { repository: system, path: metamodel }\n" +
          "filters: { repository: system, path: config/team/filters }\n",
      },
    });
    expect((await save(workspace, { name: "All", where: { all: [] } })).files).toEqual([
      "config/team/filters/all.yaml",
    ]);
    expect((await listed(workspace)).filters.map((f) => f.file)).toEqual(["config/team/filters/all.yaml"]);
    expect(await fs.readdir(fixture.path("config/team/filters"))).toEqual(["all.yaml"]);
  });

  it("[SR-035/AK2] saves the condition emergent, and running the saved filter gives what the condition gives", async () => {
    const { fixture, workspace } = await open();
    expect(await save(workspace, { name: "Emergent", where: { emergent: true } })).toEqual({
      files: ["filters/emergent.yaml"],
      problems: [],
    });
    expect(await read(fixture, "filters/emergent.yaml")).toContain("where:\n  emergent: true\n");
    const run = async (selection: Record<string, unknown>): Promise<string[]> => {
      const out = (await invoke(
        "element.list",
        { selection },
        { workspace },
      )) as CommandOutput<"element.list">;
      return out.elements.map((e) => e.id);
    };
    expect(await run({ filter: "Emergent" })).toEqual([`${P}b3`]);
    expect(await run({ filter: "Emergent" })).toEqual(await run({ where: { emergent: true } }));
  });

  it("checks the filter as a selection does, naming the field, and writes nothing then", async () => {
    const { fixture, workspace } = await open();
    const refused = async (input: Record<string, unknown>): Promise<unknown> => {
      const error = await failure(workspace, { name: "Wrong", ...input });
      return { code: error.code, fields: error.details?.["fields"] };
    };
    expect(await refused({ where: { all: [{ package: "SR-0000b1" }] } })).toEqual({
      code: "input.invalid",
      fields: ["where.all[0].package"],
    });
    expect(await refused({ where: { package: "PKG-ffffff" } })).toEqual({
      code: "ref.unknown",
      fields: undefined,
    });
    expect(await refused({ where: { all: [] }, view: "SR-0000b1" })).toEqual({
      code: "input.invalid",
      fields: ["view"],
    });
    expect(await refused({ where: { all: [] }, sort: [{ by: "title" }, { by: "hierarchy" }] })).toEqual({
      code: "input.invalid",
      fields: ["sort[1].by"],
    });
    expect(await refused({ where: { all: [] }, sort: [{ by: "packages" }] })).toEqual({
      code: "input.invalid",
      fields: ["sort[0].by"],
    });
    const name = await failure(workspace, { name: " Padded", where: { all: [] } });
    expect(name.code).toBe("input.invalid");
    expect(name.message).toContain("is not a filter name");
    await expect(fs.readdir(fixture.path("filters"))).rejects.toThrow();
  });

  it("refuses a name that only a faulty filter file holds, and a file it cannot change in place", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "filters/broken.yaml": "reqseq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n",
        "filters/flow.yaml": "{ reqseq-filter: 1, name: Flow, where: { all: [] } }\n",
      },
    });
    const broken = await failure(workspace, { name: "broken", where: { all: [] } });
    expect([broken.code, broken.details]).toEqual(["file.faulty", { files: ["filters/broken.yaml"] }]);
    // Unchanged: nothing to write, so the layout does not matter.
    expect((await save(workspace, { name: "Flow", where: { all: [] } })).files).toEqual([]);
    expect((await failure(workspace, { name: "Flow", where: { any: [] } })).code).toBe("file.faulty");
    expect(await fs.readdir(fixture.path("filters"))).toEqual(["broken.yaml", "flow.yaml"]);
  });

  it("refuses when the repository of the filters folder is not on this machine (SR-006)", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
          "metamodel: { repository: system, path: metamodel }\n" +
          "filters: { repository: vault, path: filters }\n",
      },
    });
    const error = await failure(workspace, { name: "All", where: { all: [] } });
    expect([error.code, error.details]).toEqual(["file.folder-missing", { repository: "vault" }]);
    expect(await listed(workspace)).toEqual({ filters: [], problems: [], incomplete: true });
  });

  it("is refused on a read-only workspace (SR-011 AK3)", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: { "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n" },
    });
    expect((await failure(workspace, { name: "All", where: { all: [] } })).code).toBe("workspace.read-only");
  });
});
