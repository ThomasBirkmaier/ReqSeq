// perspective.save (SR-213 AK1, AK3) on fixtures/SR-069/filter (see commands/element/list.test.ts for
// its elements): packages PKG-0000d1 and PKG-0000d2, system requirements SR-0000b1 to SR-0000b5.
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

type Saved = CommandOutput<"perspective.save">;
type Listed = CommandOutput<"perspective.list">;

const P = "69069069-0000-4000-8000-0000000000";

const WORKSPACE = (extra: string): string =>
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  `metamodel: { repository: system, path: metamodel }\n${extra}`;

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
  (await invoke("perspective.save", input, { workspace })) as Saved;

const listed = async (workspace: Workspace): Promise<Listed> =>
  (await invoke("perspective.list", {}, { workspace })) as Listed;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await save(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("perspective.save did not fail");
};

const read = (fixture: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(fixture.path(file), "utf8");

describe("perspective.save (SR-213)", () => {
  it("[SR-213/AK-vkfg] saves conditions, a saved filter, a grouping and a sort as a YAML file in the perspectives folder, without a view", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: { "filters/sensors.yaml": "reqseq-filter: 1\nname: Sensors\nwhere: { package: PKG-0000d1 }\n" },
    });
    const out = await save(workspace, {
      name: "Draft requirements by package",
      description: "What is still open",
      filter: "SENSORS",
      where: { all: [{ type: ["system-requirement"] }, { package: "pkg-0000d1" }, { status: ["draft"] }] },
      group: "package",
      sort: [{ by: "title" }],
    });
    expect(out).toEqual({ files: ["perspectives/draft-requirements-by-package.yaml"], problems: [] });
    const text = await read(fixture, "perspectives/draft-requirements-by-package.yaml");
    expect(text).toBe(
      [
        "reqseq-perspective: 1",
        "name: Draft requirements by package",
        "description: What is still open",
        "filter: Sensors",
        "where:",
        "  all:",
        "    - type: [system-requirement]",
        `    - package: ${P}d1`,
        "    - status: [draft]",
        "group: package",
        "sort:",
        "  - by: title",
        "    order: asc",
        "",
      ].join("\n"),
    );
    expect(fileSchemaValidator("perspective.schema.json")(parse(text))).toBe(true);
    // No view: neither the input nor the file takes one.
    expect((await failure(workspace, { name: "Seen", where: { all: [] }, view: "core" })).code).toBe(
      "input.invalid",
    );
    expect(fileSchemaValidator("perspective.schema.json")({ ...parse(text), view: "core" })).toBe(false);
    // A selection with no condition is `{ all: [] }`.
    expect((await save(workspace, { name: "Everything", where: { all: [] } })).files).toEqual([
      "perspectives/everything.yaml",
    ]);
    expect(await read(fixture, "perspectives/everything.yaml")).toBe(
      "reqseq-perspective: 1\nname: Everything\nwhere:\n  all: []\n",
    );
    // A saved filter of the same name is another thing: perspectives have their own names.
    expect((await save(workspace, { name: "Sensors", where: { all: [] } })).files).toEqual([
      "perspectives/sensors.yaml",
    ]);
  });

  it("[SR-213/AK-vkfg] writes into the place the workspace file names for perspectives, creating its folders", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "reqseq-workspace.yaml": WORKSPACE("perspectives: { repository: system, path: team/lists }\n"),
      },
    });
    expect((await save(workspace, { name: "NUL", where: { all: [] } })).files).toEqual([
      "team/lists/nul-perspective.yaml",
    ]);
    expect((await save(workspace, { name: "???", where: { all: [] } })).files).toEqual([
      "team/lists/perspective.yaml",
    ]);
    expect(await fs.readdir(fixture.path("team/lists"))).toEqual([
      "nul-perspective.yaml",
      "perspective.yaml",
    ]);
    await expect(fs.readdir(fixture.path("perspectives"))).rejects.toThrow();
  });

  it("[SR-213/AK-mfbk] saves under an existing name, in any case and normal form, into its file: only changed lines, comments and the description stay", async () => {
    const composed = "Prüfungen";
    const decomposed = "Prüfungen";
    const hand = [
      "# Kept by the team",
      "reqseq-perspective: 1",
      `name: ${composed}   # as the app shows it`,
      "description: Open checks   # for the review",
      "where:",
      "  status: [draft]   # only drafts",
      "group: status   # by status",
      "# Order of the list",
      "sort:",
      "  - { by: title }",
      "",
    ].join("\n");
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: { "perspectives/mine.yaml": hand },
    });
    // The same perspective without a description: nothing to write, the description stays.
    const same = { where: { status: ["draft"] }, group: "status", sort: [{ by: "title" }] };
    expect(await save(workspace, { name: composed, ...same })).toEqual({ files: [], problems: [] });
    expect(await read(fixture, "perspectives/mine.yaml")).toBe(hand);
    // The name in another normal form and case is the same perspective; only its line changes.
    const renamed = decomposed.toUpperCase();
    expect(await save(workspace, { name: renamed, ...same })).toEqual({
      files: ["perspectives/mine.yaml"],
      problems: [],
    });
    expect(await read(fixture, "perspectives/mine.yaml")).toBe(
      hand.replace(`name: ${composed}   # as the app shows it`, `name: ${renamed}`),
    );
    // A new grouping, the sort left out: those lines change, the rest stays.
    await save(workspace, { name: composed, where: { status: ["draft"] }, group: "package" });
    expect(await read(fixture, "perspectives/mine.yaml")).toBe(
      [
        "# Kept by the team",
        "reqseq-perspective: 1",
        `name: ${composed}`,
        "description: Open checks   # for the review",
        "where:",
        "  status: [draft]   # only drafts",
        "group: package",
        "# Order of the list",
        "",
      ].join("\n"),
    );
    // A description given replaces it; an empty one removes it.
    await save(workspace, {
      name: composed,
      description: "Checks",
      where: { status: ["draft"] },
      group: "package",
    });
    expect(await read(fixture, "perspectives/mine.yaml")).toContain("description: Checks\n");
    await save(workspace, {
      name: composed,
      description: "",
      where: { status: ["draft"] },
      group: "package",
    });
    expect(parse(await read(fixture, "perspectives/mine.yaml"))).toEqual({
      "reqseq-perspective": 1,
      name: composed,
      where: { status: ["draft"] },
      group: "package",
    });
    expect(await fs.readdir(fixture.path("perspectives"))).toEqual(["mine.yaml"]);
  });

  it("does not write an empty description into a new file", async () => {
    const { fixture, workspace } = await open();
    await save(workspace, { name: "Plain", description: "", where: { all: [] } });
    expect(await read(fixture, "perspectives/plain.yaml")).toBe(
      "reqseq-perspective: 1\nname: Plain\nwhere:\n  all: []\n",
    );
  });

  it("checks the perspective as element.list checks a list, naming the field, and writes nothing then", async () => {
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: { "filters/broken.yaml": "reqseq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n" },
    });
    const refused = async (input: Record<string, unknown>): Promise<unknown> => {
      const error = await failure(workspace, { name: "Wrong", where: { all: [] }, ...input });
      return { code: error.code, fields: error.details?.["fields"] };
    };
    expect(await refused({ where: { all: [{ package: "SR-0000b1" }] } })).toEqual({
      code: "input.invalid",
      fields: ["where.all[0].package"],
    });
    expect(await refused({ sort: [{ by: "packages" }] })).toEqual({
      code: "input.invalid",
      fields: ["sort[0].by"],
    });
    // A text property with a value per element, a relation kind, an unknown key: no grouping.
    for (const group of ["title", "refines", "nope"]) {
      expect(await refused({ group })).toEqual({ code: "input.invalid", fields: ["group"] });
    }
    const unknown = await failure(workspace, { name: "Wrong", where: { all: [] }, filter: "Nope" });
    expect([unknown.code, unknown.details?.["fields"]]).toEqual(["input.invalid", ["filter"]]);
    expect(unknown.message).toContain('no saved filter is named "Nope"');
    const faulty = await failure(workspace, { name: "Wrong", where: { all: [] }, filter: "broken" });
    expect([faulty.code, faulty.details]).toEqual(["file.faulty", { files: ["filters/broken.yaml"] }]);
    await expect(fs.readdir(fixture.path("perspectives"))).rejects.toThrow();
  });

  it("[SR-008/AK-kdrw] refuses a name that only a faulty perspective file holds, and never changes that file", async () => {
    const broken = "reqseq-perspective: 1\nname: Broken\nwhere: { nope: 1 }\n";
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: { "perspectives/broken.yaml": broken },
    });
    const error = await failure(workspace, { name: "BROKEN", where: { all: [] } });
    expect([error.code, error.details]).toEqual(["file.faulty", { files: ["perspectives/broken.yaml"] }]);
    expect(error.message).toContain('The perspective "BROKEN" is in a faulty file');
    expect(await fs.readdir(fixture.path("perspectives"))).toEqual(["broken.yaml"]);
    expect(await read(fixture, "perspectives/broken.yaml")).toBe(broken);
  });

  it("refuses when the repository of the perspectives folder is not on this machine (SR-006)", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "reqseq-workspace.yaml": WORKSPACE(
          "perspectives: { repository: vault, path: perspectives }\n",
        ).replace(
          "main: true }\n",
          'main: true }\n  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n',
        ),
      },
    });
    const error = await failure(workspace, { name: "All", where: { all: [] } });
    expect([error.code, error.details]).toEqual(["file.folder-missing", { repository: "vault" }]);
    expect(error.message).toContain("the perspectives folder is in repository vault");
    expect(await listed(workspace)).toEqual({ perspectives: [], problems: [], incomplete: true });
  });

  it("[SR-083/AK-s4q9] writes no perspective below .git, also when the workspace file places the perspectives folder there", async () => {
    const flow = "reqseq-perspective: 1\nname: Flow\nwhere: { all: [] }\n";
    const { fixture, workspace } = await open({
      fixture: "SR-069/filter",
      files: {
        "reqseq-workspace.yaml": WORKSPACE("perspectives: { repository: system, path: .git/views }\n"),
        ".git/views/flow.yaml": flow,
      },
    });
    for (const name of ["All", "Flow"]) {
      const error = await failure(workspace, { name, where: { any: [] } });
      expect([name, error.code, error.details?.["reason"]]).toEqual([name, "input.invalid", "git-folder"]);
    }
    expect(await fs.readdir(fixture.path(".git/views"))).toEqual(["flow.yaml"]);
    expect(await read(fixture, ".git/views/flow.yaml")).toBe(flow);
  });

  it("is refused on a read-only workspace (SR-011 AK3)", async () => {
    const { workspace } = await open({
      fixture: "SR-069/filter",
      files: { "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n" },
    });
    expect((await failure(workspace, { name: "All", where: { all: [] } })).code).toBe("workspace.read-only");
  });
});
