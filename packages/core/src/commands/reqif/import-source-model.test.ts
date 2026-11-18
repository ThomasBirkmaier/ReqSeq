// reqif.import keeps the source's model in the mapping it names (SR-158, reqif/source-model.ts) on
// SR-004/one-repository with the delivery and mapping of fixtures/SR-053/delivery. No acceptance
// criterion of SR-158 is met by this alone: they are about the export.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-053/delivery/${name}`, import.meta.url), "utf8");
const DELIVERY = sample("lieferung.reqif");
const MAPPING = sample("kunde-a.yaml");

const INPUT = { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" };

/** The source model the delivery gives through the mapping: Customer Requirement and its datatypes, not Heading. */
const MODEL = {
  datatypes: [
    { identifier: "dt-string", kind: "string", "max-length": "1000" },
    { identifier: "dt-xhtml", kind: "xhtml" },
    {
      identifier: "dt-priority",
      kind: "enumeration",
      values: [
        { identifier: "ev-high", "long-name": "High", key: "1", "other-content": "" },
        { identifier: "ev-low", "long-name": "Low", key: "2", "other-content": "" },
      ],
    },
  ],
  types: [
    {
      identifier: "ot-req",
      "long-name": "Customer Requirement",
      attributes: [
        { identifier: "ad-name", "long-name": "ReqIF.Name", datatype: "dt-string" },
        { identifier: "ad-text", "long-name": "ReqIF.Text", datatype: "dt-xhtml" },
        { identifier: "ad-priority", "long-name": "Priority", datatype: "dt-priority" },
        { identifier: "ad-comment", "long-name": "Internal Comment", datatype: "dt-string" },
      ],
    },
  ],
};

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { "in/lieferung.reqif": DELIVERY, "reqif/kunde-a.yaml": MAPPING, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const run = async (workspace: Workspace, input: Record<string, unknown> = INPUT): Promise<Imported> =>
  (await invoke("reqif.import", input, { workspace })) as Imported;

const failure = async (
  workspace: Workspace,
  input: Record<string, unknown> = INPUT,
): Promise<CommandError> => {
  try {
    await run(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.import did not fail");
};

const text = (fixture: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(fixture.path(file), "utf8");

/** The element files below `folder`. */
const elementsIn = async (fixture: FixtureWorkspace, folder: string): Promise<string[]> =>
  (await fs.readdir(fixture.path(folder)).catch(() => [])).filter((f) => f.endsWith(".md"));

describe("reqif.import stores the source model in the mapping (SR-158)", () => {
  it("saves the mapped types with every attribute and the datatypes they use, after the elements, and keeps the rest of the file", async () => {
    const { fixture, workspace } = await open();
    const out = await run(workspace);
    expect(out.files).toHaveLength(3);
    expect(out.files.at(-1)).toBe("reqif/kunde-a.yaml");
    const saved = await text(fixture, "reqif/kunde-a.yaml");
    expect(saved.startsWith(MAPPING)).toBe(true);
    expect((parse(saved) as Record<string, unknown>)["source-model"]).toEqual(MODEL);
    // The mapping stays readable for the next import.
    const again = await run(workspace, { ...INPUT, delivery: "Lastenheft 2026-12" });
    expect(again.files).not.toContain("reqif/kunde-a.yaml");
    expect(await text(fixture, "reqif/kunde-a.yaml")).toBe(saved);
  });

  it("replaces a type the same types entry maps, keeps one of another entry and drops datatypes nothing uses", async () => {
    const stored = [
      "source-model:",
      "  datatypes:",
      "    - { identifier: dt-old, kind: string }",
      "    - { identifier: dt-other, kind: integer, min: '0', max: '9' }",
      "  types:",
      "    - identifier: ot-before",
      "      long-name: Customer Requirement",
      "      attributes: [{ identifier: ad-old, datatype: dt-old }]",
      "    - identifier: ot-elsewhere",
      "      attributes: [{ identifier: ad-other, datatype: dt-other }]",
      "",
    ].join("\n");
    const { fixture, workspace } = await open({ "reqif/kunde-a.yaml": `${MAPPING}${stored}` });
    await run(workspace);
    const model = (parse(await text(fixture, "reqif/kunde-a.yaml")) as Record<string, unknown>)[
      "source-model"
    ];
    expect(model).toEqual({
      datatypes: [...MODEL.datatypes, { identifier: "dt-other", kind: "integer", min: "0", max: "9" }],
      types: [
        ...MODEL.types,
        { identifier: "ot-elsewhere", attributes: [{ identifier: "ad-other", datatype: "dt-other" }] },
      ],
    });
  });

  it("writes nothing when the mapping omits every type and has no source model", async () => {
    const { fixture, workspace } = await open({
      "reqif/kunde-a.yaml": MAPPING.replace("type: system-requirement", "omit: true"),
    });
    const out = await run(workspace);
    expect(out.files).toEqual([]);
    expect(await text(fixture, "reqif/kunde-a.yaml")).not.toContain("source-model");
  });

  it("warns and still imports when the mapping lies outside the mapping folder, which it leaves as it was", async () => {
    const { fixture, workspace } = await open({ "in/kunde-a.yaml": MAPPING });
    const out = await run(workspace, { ...INPUT, mapping: "in/kunde-a.yaml" });
    expect(out.created).toHaveLength(2);
    expect(out.files.every((f) => f.startsWith("Kunde-A/"))).toBe(true);
    expect(out.problems).toEqual([
      expect.objectContaining({
        code: "reqif.source-model-unsaved",
        severity: "warning",
        message:
          "The source model was not saved: mapping in/kunde-a.yaml is not a .yaml file directly in the mapping folder reqif of repository system",
      }),
    ]);
    expect(await text(fixture, "in/kunde-a.yaml")).toBe(MAPPING);
  });

  it("refuses the import before any write when the mapping folder is a link", async () => {
    const { fixture, workspace } = await open({ "real/kunde-a.yaml": MAPPING });
    await fs.rm(fixture.path("reqif"), { recursive: true });
    await fs.symlink(fixture.path("real"), fixture.path("reqif"), "junction");
    const error = await failure(workspace);
    expect([error.code, error.details?.["reason"]]).toEqual(["input.invalid", "link"]);
    expect(await elementsIn(fixture, "Kunde-A")).toEqual([]);
    expect(await text(fixture, "real/kunde-a.yaml")).toBe(MAPPING);
  });

  it("warns for a mapping outside a mapping folder that is a link, instead of refusing the import", async () => {
    const { fixture, workspace } = await open({ "real/kunde-a.yaml": MAPPING, "in/kunde-a.yaml": MAPPING });
    await fs.rm(fixture.path("reqif"), { recursive: true });
    await fs.symlink(fixture.path("real"), fixture.path("reqif"), "junction");
    const out = await run(workspace, { ...INPUT, mapping: "in/kunde-a.yaml" });
    expect(out.created).toHaveLength(2);
    expect((out.problems ?? []).map((p) => p.code)).toEqual(["reqif.source-model-unsaved"]);
    expect(await text(fixture, "in/kunde-a.yaml")).toBe(MAPPING);
  });

  it("refuses a mapping in a mapping folder that is a link also when the workspace is opened through a link", async () => {
    const { fixture } = await open({ "real/kunde-a.yaml": MAPPING });
    await fs.rm(fixture.path("reqif"), { recursive: true });
    await fs.symlink(fixture.path("real"), fixture.path("reqif"), "junction");
    const alias = `${fixture.root}-alias`;
    await fs.symlink(fixture.root, alias, "junction");
    onTestFinished(() => fs.rm(alias, { force: true }));
    const workspace = new Workspace(alias);
    onTestFinished(() => workspace.close());
    const error = await failure(workspace);
    expect([error.code, error.details?.["reason"]]).toEqual(["input.invalid", "link"]);
    expect(await elementsIn(fixture, "Kunde-A")).toEqual([]);
  });

  it("saves into the mapping folder named through a link to it", async () => {
    const { fixture, workspace } = await open();
    await fs.symlink(fixture.path("reqif"), fixture.path("alias"), "junction");
    const out = await run(workspace, { ...INPUT, mapping: "alias/kunde-a.yaml" });
    expect(out.files.at(-1)).toBe("reqif/kunde-a.yaml");
    expect(await text(fixture, "reqif/kunde-a.yaml")).toContain("source-model:");
  });

  it("refuses a mapping whose source model names a datatype it does not define (file.faulty)", async () => {
    const dangling = [
      "source-model:",
      "  datatypes: []",
      "  types: [{ identifier: ot-req, attributes: [{ identifier: ad-name, datatype: dt-gone }] }]",
      "",
    ].join("\n");
    const { fixture, workspace } = await open({ "reqif/kunde-a.yaml": `${MAPPING}${dangling}` });
    const error = await failure(workspace);
    expect([error.code, error.details?.["fields"]]).toEqual(["file.faulty", ["mapping"]]);
    expect(error.message).toContain("kunde-a.yaml");
    expect(error.message).toContain("dt-gone");
    expect(await elementsIn(fixture, "Kunde-A")).toEqual([]);
  });

  it("stores nothing for a file of ReqSeq, also through a mapping", async () => {
    const own = DELIVERY.replace(
      /<REQ-IF-TOOL-ID>[^<]*<\/REQ-IF-TOOL-ID>/,
      "<REQ-IF-TOOL-ID>reqseq</REQ-IF-TOOL-ID>",
    );
    expect(own).toContain("<REQ-IF-TOOL-ID>reqseq</REQ-IF-TOOL-ID>");
    const { fixture, workspace } = await open({ "in/lieferung.reqif": own });
    const out = await run(workspace);
    expect(out.created).toHaveLength(2);
    expect(out.files).not.toContain("reqif/kunde-a.yaml");
    expect(await text(fixture, "reqif/kunde-a.yaml")).toBe(MAPPING);
  });
});
