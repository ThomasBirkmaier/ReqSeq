// reqif.analyze and the refusal of reqif.import for unknown types (SR-055) on SR-004/one-repository
// with the delivery of fixtures/SR-053/delivery: the list before any write (AK1), the import after
// each entry is mapped or omitted (AK2), and no file changed by a refused import (AK3).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Analysis = CommandOutput<"reqif.analyze">;
type Imported = CommandOutput<"reqif.import">;

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-053/delivery/${name}`, import.meta.url), "utf8");
const DELIVERY = sample("lieferung.reqif");
/** The mapping of the fixture, which maps or omits every entry. */
const FULL = sample("kunde-a.yaml");

/** A mapping that maps the requirements and their name only. */
const PARTIAL = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Kunde A }",
  "types: [{ source: Customer Requirement, type: system-requirement }]",
  "attributes: [{ source: ReqIF.Name, property: title }]",
  "",
].join("\n");

/** What PARTIAL neither maps nor omits. */
const UNMAPPED = [
  { kind: "attribute", source: "ReqIF.Text", sourceType: "Customer Requirement" },
  { kind: "attribute", source: "Priority", sourceType: "Customer Requirement" },
  { kind: "attribute", source: "Internal Comment", sourceType: "Customer Requirement" },
  { kind: "type", source: "Heading" },
  { kind: "attribute", source: "Heading Text", sourceType: "Heading" },
  { kind: "relation", source: "satisfies" },
];

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { "in/lieferung.reqif": DELIVERY, "reqif/kunde-a.yaml": PARTIAL, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const IMPORT = { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" };

const analyze = async (workspace: Workspace, input: Record<string, unknown>): Promise<Analysis> =>
  (await invoke("reqif.analyze", input, { workspace })) as Analysis;

const refusal = async (
  workspace: Workspace,
  input: Record<string, unknown> = IMPORT,
): Promise<CommandError> => {
  try {
    await invoke("reqif.import", input, { workspace });
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.import did not fail");
};

/** Every file below the workspace with the SHA-256 of its bytes, without `.git`. */
const snapshot = async (fixture: FixtureWorkspace): Promise<Record<string, string>> => {
  const entries = await fs.readdir(fixture.root, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries.filter((e) => e.isFile() && !e.parentPath.split(/[\\/]/).includes(".git"))) {
    const file = `${entry.parentPath}/${entry.name}`;
    files[file.slice(fixture.root.length + 1).replaceAll("\\", "/")] = createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  }
  return files;
};

describe("unknown types before a ReqIF import (SR-055)", () => {
  it("[SR-055/AK1] reqif.analyze lists the types and attributes without mapping before any file is written, and reqif.import refuses with reqif.unmapped and the same list", async () => {
    const { fixture, workspace } = await open();
    const before = await snapshot(fixture);
    const analysis = await analyze(workspace, { file: IMPORT.file, mapping: IMPORT.mapping });
    expect(analysis).toEqual({
      unmapped: UNMAPPED,
      new: [],
      changed: [],
      dropped: [],
      conflicts: [],
      losses: [],
    });
    expect(await snapshot(fixture)).toEqual(before);
    const error = await refusal(workspace);
    expect(error.code).toBe("reqif.unmapped");
    expect(error.details?.["unmapped"]).toEqual(analysis.unmapped);
    expect(await snapshot(fixture)).toEqual(before);
    // Without a mapping, every type and relation type with the attributes of each type.
    expect((await analyze(workspace, { file: IMPORT.file })).unmapped).toEqual([
      { kind: "type", source: "Customer Requirement" },
      { kind: "attribute", source: "ReqIF.Name", sourceType: "Customer Requirement" },
      ...UNMAPPED,
    ]);
    expect(await snapshot(fixture)).toEqual(before);
  });

  it("[SR-055/AK2] after each listed entry is mapped or omitted (a choice property with its values, in a second round), through reqif.saveMapping or in the YAML file, the import runs", async () => {
    const { fixture, workspace } = await open();
    await invoke(
      "reqif.saveMapping",
      {
        file: "reqif/kunde-a.yaml",
        mapping: {
          "reqseq-reqif-mapping": 1,
          source: { name: "Kunde A" },
          types: [
            { source: "Customer Requirement", type: "system-requirement" },
            { source: "Heading", omit: true },
          ],
          attributes: [
            { source: "ReqIF.Name", property: "title" },
            { source: "ReqIF.Text", property: "text" },
            { source: "Priority", omit: true },
            { source: "Internal Comment", omit: true },
            { source: "Heading Text", omit: true },
          ],
          relations: [{ source: "satisfies", omit: true }],
        },
      },
      { workspace },
    );
    const analysis = await analyze(workspace, { file: IMPORT.file, mapping: IMPORT.mapping });
    expect(analysis.unmapped).toEqual([]);
    expect(analysis.new).toEqual([{ identifier: "REQ-1" }, { identifier: "REQ-2" }]);
    const out = (await invoke("reqif.import", IMPORT, { workspace })) as Imported;
    expect(out.created.map((c) => c.identifier)).toEqual(["REQ-1", "REQ-2"]);
    // The same in the YAML file, for a second source.
    await fs.writeFile(
      fixture.path("reqif/kunde-b.yaml"),
      [
        "reqseq-reqif-mapping: 1",
        "source: { name: Kunde B }",
        "types: [{ source: Customer Requirement, type: system-requirement }, { source: Heading, omit: true }]",
        "attributes:",
        "  - { source: ReqIF.Name, property: title }",
        "  - { source: ReqIF.Text, omit: true }",
        "  - { source: Priority, omit: true }",
        "  - { source: Internal Comment, omit: true }",
        "relations: [{ source: satisfies, kind: derives-from }]",
        "",
      ].join("\n"),
    );
    const second = (await invoke(
      "reqif.import",
      { ...IMPORT, mapping: "reqif/kunde-b.yaml" },
      { workspace },
    )) as Imported;
    expect(second.files.every((f) => f.startsWith("Kunde-B/"))).toBe(true);
    expect(second.created).toHaveLength(2);
    // A choice property: its values are listed only once it is chosen, in a second round.
    const third = (values: string): string =>
      [
        "reqseq-reqif-mapping: 1",
        "source: { name: Kunde C }",
        "types: [{ source: Customer Requirement, type: system-requirement }, { source: Heading, omit: true }]",
        "attributes:",
        "  - { source: ReqIF.Name, property: title }",
        "  - { source: ReqIF.Text, omit: true }",
        `  - { source: Priority, property: requirement-type${values} }`,
        "  - { source: Internal Comment, omit: true }",
        "relations: [{ source: satisfies, omit: true }]",
        "",
      ].join("\n");
    const kundeC = { ...IMPORT, mapping: "reqif/kunde-c.yaml" };
    await fs.writeFile(fixture.path("reqif/kunde-c.yaml"), third(""));
    const round2 = await analyze(workspace, { file: IMPORT.file, mapping: kundeC.mapping });
    const value = (source: string) => ({
      kind: "value",
      source,
      sourceType: "Customer Requirement",
      attribute: "Priority",
    });
    expect(round2.unmapped).toHaveLength(2);
    expect(round2.unmapped).toEqual(expect.arrayContaining([value("High"), value("Low")]));
    await fs.writeFile(
      fixture.path("reqif/kunde-c.yaml"),
      third(", values: { High: functional, Low: quality }"),
    );
    const done = (await invoke("reqif.import", kundeC, { workspace })) as Imported;
    expect(done.created).toHaveLength(2);
  });

  it("[SR-055/AK3] a refused import changes no file: a missing mapping, an invalid file, a mapping the metamodel refuses", async () => {
    const { fixture, workspace } = await open({
      "in/broken.reqif": DELIVERY.slice(0, DELIVERY.length / 2),
      "reqif/wrong.yaml": FULL.replace("property: title", "property: requirement-type"),
    });
    const before = await snapshot(fixture);
    expect((await refusal(workspace)).code).toBe("reqif.unmapped");
    expect((await refusal(workspace, { ...IMPORT, file: "in/broken.reqif" })).code).toBe("reqif.invalid");
    expect((await refusal(workspace, { ...IMPORT, mapping: "reqif/wrong.yaml" })).code).toBe("input.invalid");
    expect(await snapshot(fixture)).toEqual(before);
  });
});

describe("reqif.analyze", () => {
  it("lists the objects the import would create and its losses, without UUIDs, and passes other refusals on", async () => {
    const { workspace } = await open({
      "reqif/full.yaml": FULL,
      "reqif/no-heading.yaml": FULL.replace("  - { source: Heading, omit: true }\n", "").replace(
        "attributes:\n",
        "attributes:\n  - { source: Heading Text, omit: true }\n",
      ),
      "reqif/wrong.yaml": FULL.replace("property: title", "property: requirement-type"),
      // A header without TITLE: the IDENTIFIER names the source.
      "in/untitled.reqif": DELIVERY.replace(/<TITLE>[^<]*<\/TITLE>/, ""),
    });
    const analysis = await analyze(workspace, { file: IMPORT.file, mapping: "reqif/full.yaml" });
    expect(analysis.new).toEqual([{ identifier: "REQ-1" }, { identifier: "REQ-2" }]);
    expect(analysis.losses.length).toBeGreaterThan(0);
    expect(analysis.losses.every((l) => l.id === undefined)).toBe(true);
    await expect(analyze(workspace, { file: "in/none.reqif" })).rejects.toThrow(CommandError);
    await expect(
      analyze(workspace, { file: IMPORT.file, mapping: "reqif/wrong.yaml" }),
    ).rejects.toMatchObject({ code: "input.invalid" });
    // The header TITLE or IDENTIFIER names the source without a mapping; a given source wins.
    expect((await analyze(workspace, { file: IMPORT.file, source: "Kunde A" })).unmapped).not.toEqual([]);
    expect((await analyze(workspace, { file: "in/untitled.reqif" })).unmapped).not.toEqual([]);
    // An attribute the mapping maps is not listed under its unmapped type.
    expect(
      (await analyze(workspace, { file: IMPORT.file, mapping: "reqif/no-heading.yaml" })).unmapped,
    ).toEqual([{ kind: "type", source: "Heading" }]);
  });
});
