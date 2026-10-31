// reqif.saveMapping (SR-054 AK1) on SR-004/one-repository (standard model, repository `system`).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { fileSchemaValidator } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Saved = CommandOutput<"reqif.saveMapping">;

const WORKSPACE_FILE = [
  "reqseq-workspace: 1",
  "name: Weather station",
  "repositories:",
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
  "metamodel: { repository: system, path: metamodel }",
];

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** A workspace file with `extra` lines. */
const withSetting = (...extra: string[]): Record<string, string> => ({
  "reqseq-workspace.yaml": [...WORKSPACE_FILE, ...extra, ""].join("\n"),
});

const save = async (workspace: Workspace, input: Record<string, unknown>): Promise<Saved> =>
  (await invoke("reqif.saveMapping", input, { workspace })) as Saved;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await save(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.saveMapping did not fail");
};

const read = (fixture: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(fixture.path(file), "utf8");

const metamodelHash = async (fixture: FixtureWorkspace): Promise<string> =>
  createHash("sha256")
    .update(await read(fixture, "metamodel/standard-model.yaml"))
    .digest("hex");

const MAPPING = {
  "reqseq-reqif-mapping": 1,
  source: { name: "Kunde A", "tool-id": "DOORS Next" },
  types: [
    { source: "Customer Requirement", type: "system-requirement" },
    { source: "Heading", omit: true },
  ],
  attributes: [
    { source: "ReqIF.Name", property: "title" },
    { source: "ReqIF.Text", property: "text" },
    {
      source: "Priority",
      "source-type": "Customer Requirement",
      property: "requirement-type",
      values: { High: "functional", Low: "quality" },
    },
    { source: "Internal Comment", omit: true },
  ],
  relations: [{ source: "satisfies", kind: "derives-from" }],
} as const;

describe("reqif.saveMapping (SR-054)", () => {
  it("[SR-054/AK1] saves the mapping of a source's types and attributes as a YAML file in the folder reqif of the main repository", async () => {
    const { fixture, workspace } = await open();
    const before = await metamodelHash(fixture);
    expect(await save(workspace, { mapping: MAPPING })).toEqual({
      files: ["reqif/kunde-a.yaml"],
      problems: [],
    });
    const text = await read(fixture, "reqif/kunde-a.yaml");
    expect(text).toBe(
      [
        "reqseq-reqif-mapping: 1",
        "source:",
        "  name: Kunde A",
        "  tool-id: DOORS Next",
        "types:",
        "  - source: Customer Requirement",
        "    type: system-requirement",
        "  - source: Heading",
        "    omit: true",
        "attributes:",
        "  - source: ReqIF.Name",
        "    property: title",
        "  - source: ReqIF.Text",
        "    property: text",
        "  - source: Priority",
        "    source-type: Customer Requirement",
        "    property: requirement-type",
        "    values:",
        "      High: functional",
        "      Low: quality",
        "  - source: Internal Comment",
        "    omit: true",
        "relations:",
        "  - source: satisfies",
        "    kind: derives-from",
        "",
      ].join("\n"),
    );
    expect(fileSchemaValidator("reqif-mapping.schema.json")(parse(text))).toBe(true);
    // The own metamodel is only read.
    expect(await metamodelHash(fixture)).toBe(before);
  });

  it("writes the keys in the schema's order and the file the input names inside the mapping folder", async () => {
    const { fixture, workspace } = await open();
    const out = await save(workspace, {
      file: fixture.path("reqif/acme.yaml"),
      mapping: {
        "export-profiles": [{ name: "All", selection: {}, "omit-properties": ["rationale"] }],
        "omit-properties": ["topic"],
        statement: { property: "statement", attribute: "Supplier Statement" },
        target: { repository: "system", path: "imported/acme" },
        source: { name: "ACME" },
        "reqseq-reqif-mapping": 1,
      },
    });
    expect(out.files).toEqual(["reqif/acme.yaml"]);
    expect(Object.keys(parse(await read(fixture, "reqif/acme.yaml")) as object)).toEqual([
      "reqseq-reqif-mapping",
      "source",
      "target",
      "statement",
      "omit-properties",
      "export-profiles",
    ]);
  });

  it("refuses a file outside the mapping folder, in a subfolder of it or without .yaml, for every access", async () => {
    const { fixture, workspace } = await open();
    for (const file of [
      fixture.path("kunde-a.yaml"),
      "reqif/sub/kunde-a.yaml",
      "reqif/../kunde-a.yaml",
      "reqif/kunde-a.yml",
    ]) {
      const error = await failure(workspace, { file, mapping: MAPPING });
      expect(error.code, file).toBe("input.invalid");
      expect(error.details).toMatchObject({ fields: ["file"], reason: "outside-mapping-folder" });
    }
    // Also through a link in the mapping folder to another folder.
    await fs.mkdir(fixture.path("reqif"));
    await fs.symlink(fixture.path("metamodel"), fixture.path("reqif/meta"), "dir");
    const linked = await failure(workspace, { file: fixture.path("reqif/meta/x.yaml"), mapping: MAPPING });
    expect(linked.details).toMatchObject({ reason: "outside-mapping-folder" });
    await expect(fs.readdir(fixture.path("metamodel"))).resolves.toEqual(["standard-model.yaml"]);
  });

  it("writes into the mapping folder the workspace file sets, creating it", async () => {
    const { fixture, workspace } = await open(
      withSetting("mappings: { repository: system, path: exchange/reqif }"),
    );
    expect((await save(workspace, { mapping: MAPPING })).files).toEqual(["exchange/reqif/kunde-a.yaml"]);
    await expect(read(fixture, "exchange/reqif/kunde-a.yaml")).resolves.toContain("name: Kunde A");
  });

  it("writes into a mapping folder at the repository root", async () => {
    const { fixture, workspace } = await open(withSetting("mappings: { repository: system, path: . }"));
    expect((await save(workspace, { mapping: MAPPING })).files).toEqual(["kunde-a.yaml"]);
    await expect(read(fixture, "kunde-a.yaml")).resolves.toContain("name: Kunde A");
  });

  it("never writes a mapping into the metamodel folder", async () => {
    const { fixture, workspace } = await open(
      withSetting("mappings: { repository: system, path: metamodel/reqif }"),
    );
    const before = await metamodelHash(fixture);
    const error = await failure(workspace, { mapping: MAPPING });
    expect(error.code).toBe("input.invalid");
    expect(error.details).toMatchObject({ reason: "metamodel-folder" });
    expect(await metamodelHash(fixture)).toBe(before);
    await expect(fs.readdir(fixture.path("metamodel"))).resolves.toEqual(["standard-model.yaml"]);
  });

  it("is file.folder-missing when the mapping folder's repository is not on this machine", async () => {
    const { workspace } = await open({
      "reqseq-workspace.yaml": [
        ...WORKSPACE_FILE.slice(0, 4),
        '  - { name: exchange, url: "git@git.example.com:ws/exchange.git", path: ../missing-exchange }',
        WORKSPACE_FILE[4] ?? "",
        "mappings: { repository: exchange, path: reqif }",
        "",
      ].join("\n"),
    });
    const error = await failure(workspace, { mapping: MAPPING });
    expect(error.code).toBe("file.folder-missing");
    expect(error.details).toMatchObject({ repository: "exchange" });
  });

  it("changes an existing file key by key, keeps its comments, removes a key left out and writes nothing when equal", async () => {
    const { fixture, workspace } = await open({
      "reqif/kunde-a.yaml": [
        "# Agreed with Kunde A",
        "reqseq-reqif-mapping: 1",
        "source: { name: Kunde A } # as in the header",
        "types:",
        "  - { source: Customer Requirement, type: system-requirement }",
        "relations:",
        "  - { source: satisfies, kind: derives-from }",
        "",
      ].join("\n"),
    });
    const mapping = {
      "reqseq-reqif-mapping": 1,
      source: { name: "Kunde A" },
      types: [{ source: "Customer Requirement", type: "system-requirement" }],
      attributes: [{ source: "ReqIF.Name", property: "title" }],
    };
    expect((await save(workspace, { mapping })).files).toEqual(["reqif/kunde-a.yaml"]);
    expect(await read(fixture, "reqif/kunde-a.yaml")).toBe(
      [
        "# Agreed with Kunde A",
        "reqseq-reqif-mapping: 1",
        "source: { name: Kunde A } # as in the header",
        "types:",
        "  - { source: Customer Requirement, type: system-requirement }",
        "attributes:",
        "  - source: ReqIF.Name",
        "    property: title",
        "",
      ].join("\n"),
    );
    expect(await save(workspace, { mapping })).toEqual({ files: [], problems: [] });
  });

  it("fills an empty existing file", async () => {
    const { fixture, workspace } = await open({ "reqif/kunde-a.yaml": "" });
    expect(
      (await save(workspace, { mapping: { "reqseq-reqif-mapping": 1, source: { name: "Kunde A" } } })).files,
    ).toEqual(["reqif/kunde-a.yaml"]);
    expect(parse(await read(fixture, "reqif/kunde-a.yaml"))).toEqual({
      "reqseq-reqif-mapping": 1,
      source: { name: "Kunde A" },
    });
  });

  it("refuses to replace a file that cannot be read as YAML", async () => {
    const { fixture, workspace } = await open({ "reqif/kunde-a.yaml": "source: [unclosed\n" });
    const error = await failure(workspace, { mapping: MAPPING });
    expect(error.code).toBe("file.faulty");
    expect(error.details).toMatchObject({ file: "reqif/kunde-a.yaml" });
    await expect(read(fixture, "reqif/kunde-a.yaml")).resolves.toBe("source: [unclosed\n");
  });

  it("refuses a mapping that does not fit the own metamodel and lists every violation", async () => {
    const { fixture, workspace } = await open();
    const error = await failure(workspace, {
      mapping: {
        "reqseq-reqif-mapping": 1,
        source: { name: "Kunde A" },
        target: { repository: "nowhere", path: "x" },
        types: [
          { source: "Requirement", type: "requirement" },
          { source: "Decision", type: "decision" },
        ],
        attributes: [
          { source: "Owner", property: "owner" },
          { source: "Priority", "source-type": "Decision", property: "requirement-type" },
          { source: "Name", property: "title", values: { A: "functional" } },
          { source: "Topic", "source-type": "Requirement", property: "topic", values: { A: "x" } },
          { source: "Kind", property: "requirement-type", values: { High: "functional", Huge: "giant" } },
          { source: "Fine", property: "requirement-type", values: { High: "functional" } },
        ],
        relations: [
          { source: "satisfies", kind: "satisfies" },
          { source: "parent", kind: "title" },
          { source: "dropped", omit: true },
        ],
        statement: { property: "remark", attribute: "Statement" },
        "omit-properties": ["topic", "derives-from"],
        "export-profiles": [
          { name: "P", selection: {}, "omit-properties": ["nothing"] },
          { name: "Q", selection: {} },
        ],
      },
    });
    expect(error.code).toBe("input.invalid");
    expect(error.details?.["fields"]).toEqual([
      "mapping.target.repository",
      "mapping.types[0].type",
      "mapping.attributes[0].property",
      "mapping.attributes[1].property",
      "mapping.attributes[2].values",
      "mapping.attributes[3].values",
      "mapping.attributes[4].values.Huge",
      "mapping.relations[0].kind",
      "mapping.relations[1].kind",
      "mapping.statement.property",
      "mapping.omit-properties[1]",
      "mapping.export-profiles[0].omit-properties[0]",
    ]);
    expect(error.message).toContain(
      "mapping.attributes[1].property: requirement-type is no property of type decision",
    );
    expect(error.message).toContain(
      "mapping.attributes[4].values.Huge: giant is no choice of requirement-type",
    );
    await expect(fs.stat(fixture.path("reqif"))).rejects.toThrow();
  });
});
