// reqif.import (SR-053) on SR-004/one-repository with the delivery and mapping of fixtures/SR-053/delivery.
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

type Imported = CommandOutput<"reqif.import">;

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/SR-053/delivery/${name}`, import.meta.url), "utf8");
const DELIVERY = sample("lieferung.reqif");
const MAPPING = sample("kunde-a.yaml");

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

const INPUT = { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" };

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

/** Every file below the workspace, relative, sorted, without `.git`. */
const tree = async (fixture: FixtureWorkspace): Promise<string[]> =>
  (await fs.readdir(fixture.root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      `${entry.parentPath.slice(fixture.root.length + 1)}/${entry.name}`
        .replace(/^\//, "")
        .replaceAll("\\", "/"),
    )
    .sort();

const metamodelHash = async (fixture: FixtureWorkspace): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(fixture.path("metamodel/standard-model.yaml")))
    .digest("hex");

const tail = (id: string): string => id.replaceAll("-", "").slice(-12);

describe("reqif.import (SR-053)", () => {
  it("[SR-053/AK1] creates an element file per SPEC-OBJECT of a mapped type and a relation per SPEC-RELATION, in a folder named after the source, each with the initial status", async () => {
    const { fixture, workspace } = await open();
    const out = await run(workspace);
    expect(out.created.map((c) => c.identifier)).toEqual(["REQ-1", "REQ-2"]);
    const [one, two] = out.created.map((c) => c.id ?? "");
    expect(out.files).toEqual([`Kunde-A/SR-${tail(one ?? "")}.md`, `Kunde-A/SR-${tail(two ?? "")}.md`]);
    expect(await fs.readFile(fixture.path(out.files[0] ?? ""), "utf8")).toBe(
      [
        "---",
        `id: ${one ?? ""}`,
        "type: system-requirement",
        "status: draft",
        "title: Measure the wind",
        "requirement-type: functional",
        "---",
        "",
        "The station shall measure the wind speed.",
        "",
        "Every 10 s.",
        "",
      ].join("\n"),
    );
    const got = (await invoke("element.get", { ref: two }, { workspace })) as CommandOutput<"element.get">;
    expect(got.element.status).toBe("draft");
    expect(got.element.properties["requirement-type"]).toBe("quality");
    const first = (await invoke("element.get", { ref: one }, { workspace })) as CommandOutput<"element.get">;
    expect(got.element.relations).toEqual([
      expect.objectContaining({ kind: "derives-from", id: one, storedVersion: first.element.version }),
    ]);
    // Nothing else was written: no temporary file is left.
    expect((await tree(fixture)).filter((f) => f.startsWith("Kunde-A/"))).toEqual([...out.files].sort());
  });

  it("[SR-053/AK1] writes into the folder the mapping names as target", async () => {
    const { fixture, workspace } = await open({
      "reqif/kunde-a.yaml": `${MAPPING}target: { repository: system, path: imported/kunde-a }\n`,
    });
    const out = await run(workspace);
    expect(out.files.every((f) => f.startsWith("imported/kunde-a/SR-"))).toBe(true);
    await expect(fs.stat(fixture.path("Kunde-A"))).rejects.toThrow();
  });

  it("[SR-053/AK2] lists every content that is not taken over without loss, with its element and reason", async () => {
    const { workspace } = await open();
    const out = await run(workspace);
    const [one] = out.created.map((c) => c.id);
    expect(out.losses).toEqual([
      {
        identifier: "REQ-1",
        kind: "spec-object",
        id: one,
        code: "xhtml-element",
        reason: "ReqIF.Text: XHTML b is not converted to Markdown yet; its text is kept",
      },
      {
        identifier: "REQ-1",
        kind: "spec-object",
        id: one,
        code: "omitted-attribute",
        reason: "the mapping omits its attribute Internal Comment",
      },
      {
        identifier: "HEAD-1",
        kind: "spec-object",
        code: "omitted-type",
        reason: "the mapping omits its type Heading",
      },
      {
        identifier: "REL-2",
        kind: "spec-relation",
        id: one,
        code: "relation-end-not-imported",
        reason: "its target HEAD-1 is not imported",
      },
      {
        identifier: "SPEC-1",
        kind: "specification",
        code: "hierarchy",
        reason: "the SPEC-HIERARCHY of Lastenheft (order and nesting) is not imported",
      },
    ]);
  });

  it("[SR-054/AK2] uses the saved mapping the command names and asks nothing about types and attributes", async () => {
    const { workspace } = await open({ "reqif/kunde-a.yaml": "" });
    await invoke(
      "reqif.saveMapping",
      {
        file: "reqif/kunde-a.yaml",
        mapping: {
          "reqseq-reqif-mapping": 1,
          source: { name: "Kunde A" },
          types: [
            { source: "Customer Requirement", type: "need" },
            { source: "Heading", omit: true },
          ],
          attributes: [
            { source: "ReqIF.Name", property: "title" },
            { source: "ReqIF.Text", property: "text" },
            { source: "Priority", omit: true },
            { source: "Internal Comment", property: "rationale" },
          ],
          relations: [{ source: "satisfies", kind: "refines" }],
        },
      },
      { workspace },
    );
    const out = await run(workspace);
    expect(out.created).toHaveLength(2);
    const got = (await invoke(
      "element.get",
      { ref: out.created[0]?.id },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect([got.element.type, got.element.properties["rationale"]]).toEqual(["need", "check with team"]);
  });

  it("[SR-054/AK3] reading the types and attributes of the source changes nothing of the own metamodel", async () => {
    const { fixture, workspace } = await open();
    const before = await metamodelHash(fixture);
    await run(workspace);
    await failure(workspace, { ...INPUT, mapping: "reqif/other.yaml" }).catch(() => undefined);
    expect(await metamodelHash(fixture)).toBe(before);
    await expect(fs.readdir(fixture.path("metamodel"))).resolves.toEqual(["standard-model.yaml"]);
    const metamodel = (await invoke("metamodel.get", {}, { workspace })) as CommandOutput<"metamodel.get">;
    expect(metamodel.types.map((t) => t.key)).not.toContain("Customer Requirement");
  });

  it("refuses with reqif.unmapped and the list when the mapping neither maps nor omits an entry, writing nothing", async () => {
    const { fixture, workspace } = await open({
      "reqif/kunde-a.yaml": [
        "reqseq-reqif-mapping: 1",
        "source: { name: Kunde A }",
        "types: [{ source: Customer Requirement, type: system-requirement }]",
        "attributes:",
        "  - { source: ReqIF.Name, property: title }",
        "  - { source: Priority, source-type: Customer Requirement, property: requirement-type, values: { High: functional } }",
        "",
      ].join("\n"),
    });
    const before = await tree(fixture);
    const error = await failure(workspace);
    expect(error.code).toBe("reqif.unmapped");
    expect(error.details?.["unmapped"]).toEqual([
      { kind: "attribute", source: "ReqIF.Text", sourceType: "Customer Requirement" },
      { kind: "value", source: "Low", sourceType: "Customer Requirement", attribute: "Priority" },
      { kind: "attribute", source: "Internal Comment", sourceType: "Customer Requirement" },
      { kind: "type", source: "Heading" },
      { kind: "relation", source: "satisfies" },
    ]);
    expect(await tree(fixture)).toEqual(before);
  });

  it("refuses an attribute mapped to a property that cannot hold it or that the type does not have", async () => {
    const { workspace } = await open({
      "reqif/kunde-a.yaml": MAPPING.replace("property: title }", "property: requirement-type }")
        .replace(
          "{ source: Internal Comment, omit: true }",
          "{ source: Internal Comment, property: statement }",
        )
        .replace("type: system-requirement", "type: need"),
    });
    const error = await failure(workspace);
    expect(error.code).toBe("input.invalid");
    expect(error.details?.["fields"]).toEqual([
      "mapping.attributes[0].property",
      "mapping.attributes[2].property",
      "mapping.attributes[3].property",
    ]);
  });

  it("is reqif.invalid for a file that is no ReqIF or refers to what it does not define, file.faulty for one it cannot read", async () => {
    const broken = DELIVERY.replace(
      "<TYPE><SPEC-OBJECT-TYPE-REF>ot-heading",
      "<TYPE><SPEC-OBJECT-TYPE-REF>ot-none",
    );
    const { fixture, workspace } = await open({
      "in/not.reqif": "<html/>",
      "in/broken.reqif": broken,
      "in/relation.reqif": DELIVERY.replace(
        "<SPEC-RELATION-TYPE-REF>rt-satisfies</SPEC-RELATION-TYPE-REF></TYPE>\n        </SPEC-RELATION>\n      </SPEC-RELATIONS>",
        "<SPEC-RELATION-TYPE-REF>rt-none</SPEC-RELATION-TYPE-REF></TYPE>\n        </SPEC-RELATION>\n      </SPEC-RELATIONS>",
      ),
      "in/value.reqif": DELIVERY.replace(
        "<ATTRIBUTE-DEFINITION-STRING-REF>ad-comment<",
        "<ATTRIBUTE-DEFINITION-STRING-REF>ad-heading<",
      ),
      "in/twice.reqif": DELIVERY.replace('IDENTIFIER="REQ-2"', 'IDENTIFIER="REQ-1"'),
      "in/datatype.reqif": DELIVERY.replace(
        "<DATATYPE-DEFINITION-XHTML-REF>dt-xhtml<",
        "<DATATYPE-DEFINITION-XHTML-REF>dt-none<",
      ),
    });
    const before = await tree(fixture);
    for (const [file, message] of [
      ["in/not.reqif", /^file: line 1: /],
      ["in/broken.reqif", /SPEC-OBJECT HEAD-1 refers to type ot-none/],
      ["in/relation.reqif", /SPEC-RELATION REL-2 refers to type rt-none/],
      ["in/value.reqif", /SPEC-OBJECT REQ-1 has a value of attribute ad-heading/],
      ["in/datatype.reqif", /attribute ad-text refers to datatype dt-none/],
      ["in/twice.reqif", /^file: line 57: IDENTIFIER REQ-1 is used twice$/],
    ] as const) {
      const error = await failure(workspace, { ...INPUT, file });
      expect([error.code, error.message], file).toEqual(["reqif.invalid", expect.stringMatching(message)]);
    }
    // A folder is no file (on Windows it cannot even be opened).
    expect((await failure(workspace, { ...INPUT, file: "in" })).code).toBe("file.faulty");
    const missing = await failure(workspace, { ...INPUT, file: "in/missing.reqif" });
    expect([missing.code, missing.message]).toEqual([
      "file.faulty",
      "file: cannot read missing.reqif: ENOENT",
    ]);
    const unnamed = await failure(workspace, { file: "in/lieferung.reqif", delivery: "x" });
    expect([unnamed.code, unnamed.details?.["fields"]]).toEqual(["input.invalid", ["mapping"]]);
    expect(await tree(fixture)).toEqual(before);
  });

  it("[SR-053/AK1] writes under the spelling of the target folder that the element walk lists (#194)", async () => {
    // On a file system that ignores the normal form (macOS) the NFC target is the NFD folder, and
    // the files go there under its spelling; elsewhere the two are different folders.
    const { fixture, workspace } = await open({
      ["Kunde-A\u0308/notes.txt"]: "",
      "reqif/kunde-a.yaml": `${MAPPING}target: { repository: system, path: "Kunde-\u00c4" }\n`,
    });
    const out = await run(workspace);
    for (const file of out.files) {
      await expect(fs.stat(fixture.path(file))).resolves.toBeDefined();
    }
    const listed = (await invoke("element.list", {}, { workspace })) as { elements: { file: string }[] };
    expect(out.files.every((f) => listed.elements.some((e) => e.file === f))).toBe(true);
  });

  it("[SR-053/AK2] writes nothing when the mapping omits every type, and lists each object as a loss", async () => {
    const { fixture, workspace } = await open({
      "reqif/kunde-a.yaml": MAPPING.replace(
        "{ source: Customer Requirement, type: system-requirement }",
        "{ source: Customer Requirement, omit: true }",
      ),
    });
    const before = await tree(fixture);
    const out = await run(workspace);
    expect([out.created, out.files]).toEqual([[], []]);
    expect(out.losses.filter((l) => l.code === "omitted-type").map((l) => l.identifier)).toEqual([
      "REQ-1",
      "REQ-2",
      "HEAD-1",
    ]);
    expect(await tree(fixture)).toEqual(before);
  });

  it("is file.folder-missing when the target's repository is not on this machine", async () => {
    const { workspace } = await open({
      "reqseq-workspace.yaml": [
        "reqseq-workspace: 1",
        "name: Weather station",
        "repositories:",
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
        '  - { name: customer, url: "git@git.example.com:ws/customer.git", path: ../missing-customer }',
        "metamodel: { repository: system, path: metamodel }",
        "",
      ].join("\n"),
      "reqif/kunde-a.yaml": `${MAPPING}target: { repository: customer, path: kunde-a }\n`,
    });
    const error = await failure(workspace);
    expect([error.code, error.details?.["repository"]]).toEqual(["file.folder-missing", "customer"]);
  });
});
