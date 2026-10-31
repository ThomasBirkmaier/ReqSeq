// reqif.export with statements (SR-058) on fixtures/SR-058/statements: three elements of source
// Kunde A (two with a statement), an own element and one of source Kunde B, and two mappings of
// Kunde A, one writing the statement as STRING and one as XHTML.
import fs from "node:fs/promises";
import { REQIF_XSD_PINS, createFixtureWorkspace, reqifXsdDir, validateReqif } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { ReqifFile } from "../../reqif/model.js";
import { parseReqif } from "../../reqif/parse.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Exported = CommandOutput<"reqif.export">;
type Listed = CommandOutput<"element.list">;

const WIND = "58058058-0000-4000-8000-0000000058a1";
const HUMIDITY = "58058058-0000-4000-8000-0000000058a3";
const STRING_MAPPING = "reqif/kunde-a.yaml";
const XHTML_MAPPING = "reqif/kunde-a-xhtml.yaml";

const open = async (files: Readonly<Record<string, string>> = {}) => {
  const made = await createFixtureWorkspace({ fixture: "SR-058/statements", files });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  return { fixture: made, workspace };
};

const run = async <T>(workspace: Workspace, input: Record<string, unknown>): Promise<T> =>
  (await invoke("reqif.export", input, { workspace })) as T;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await run(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.export did not fail");
};

const parsed = async (path: string): Promise<ReqifFile> => {
  const outcome = parseReqif(await fs.readFile(path));
  if (outcome.kind !== "parsed") {
    throw new Error(outcome.message);
  }
  return outcome.file;
};

/** Each object as its IDENTIFIER and its values as definition and value. */
const objects = (file: ReqifFile): unknown[] =>
  file.specObjects.map((o) => [
    o.identifier,
    o.values.map((v) => [v.definition, v.kind === "string" ? v.value : JSON.stringify(v)]),
  ]);

describe("reqif.export with statements (SR-058)", () => {
  it("[SR-058/AK1] exports every element of the mapping's source by its source IDENTIFIER with only its statement, an empty one counted, as STRING or XHTML, narrowed by a selection", async () => {
    const { fixture, workspace } = await open();
    const out = await run<Exported>(workspace, {
      output: "back.reqif",
      mapping: STRING_MAPPING,
      statements: true,
    });
    expect(out).toEqual({
      file: "back.reqif",
      elements: 3,
      relations: 0,
      withoutStatement: 1,
      files: [],
      problems: [],
    });
    const file = await parsed(fixture.path("back.reqif"));
    // In the order of the list; the own element and the one of Kunde B are left out.
    const order = ((await invoke("element.list", {}, { workspace })) as Listed).elements.flatMap((e) =>
      e.id.startsWith("58058058-0000-4000-8000-0000000058a") ? [e.id] : [],
    );
    const identifiers: Record<string, string> = {
      [WIND]: "_cr-1",
      "58058058-0000-4000-8000-0000000058a2": "_cr-2",
      [HUMIDITY]: "_cr-3",
    };
    const statements: Record<string, string> = {
      "_cr-1": "Accepted, **with** a range of 0 to 60 m/s.",
      "_cr-2": "",
      "_cr-3": "Not feasible.",
    };
    const expected = order.map((id) => identifiers[id] ?? "");
    expect(objects(file)).toEqual(
      expected.map((identifier) => [identifier, [["_ad-statement", statements[identifier]]]]),
    );
    expect(
      file.specTypes.map((t) => [t.identifier, t.attributes.map((a) => [a.identifier, a.longName])]),
    ).toEqual([
      ["_ot-statement", [["_ad-statement", "Supplier Statement"]]],
      ["_st-specification", []],
    ]);
    expect(file.specRelations).toEqual([]);
    expect(file.specifications[0]?.children.map((c) => c.object)).toEqual(expected);
    // As XHTML, the attribute named as the mapping names it; a selection narrows the export.
    const narrowed = await run<Exported>(workspace, {
      output: "xhtml.reqif",
      mapping: XHTML_MAPPING,
      statements: true,
      selection: { ids: [WIND, "58058058-0000-4000-8000-0000000058b1"] },
    });
    expect([narrowed.elements, narrowed.withoutStatement]).toEqual([1, 0]);
    const xhtml = await parsed(fixture.path("xhtml.reqif"));
    const [object] = xhtml.specObjects;
    expect([object?.identifier, object?.values.map((v) => [v.definition, v.kind])]).toEqual([
      "_cr-1",
      [["supplier-statement", "xhtml"]],
    ]);
    expect(JSON.stringify(object?.values)).toContain('"name":"strong"');
    expect(xhtml.datatypes.map((d) => [d.identifier, d.kind])).toEqual([["_dt-xhtml", "xhtml"]]);
  });

  it("[SR-058/AK2] writes a statements export valid against the ReqIF 1.2 schema, as STRING and as XHTML", async (context) => {
    // A statement may embed an image: its link is written as the statement has it.
    const { fixture, workspace } = await open({
      "Kunde-A/SR-0000000058a6.md": `---\nid: 58058058-0000-4000-8000-0000000058a6\ntype: system-requirement\nstatus: draft\ntitle: Sketch\nsource: Kunde A\nsource-identifier: _cr-6\nstatement: "See ![sketch](sketch.png)."\n---\n`,
    });
    await run<Exported>(workspace, { output: "string.reqif", mapping: STRING_MAPPING, statements: true });
    await run<Exported>(workspace, { output: "xhtml.reqif", mapping: XHTML_MAPPING, statements: true });
    const dir = reqifXsdDir(context, process.env);
    const pins = await fs.readFile(REQIF_XSD_PINS, "utf8");
    expect(await fs.readFile(fixture.path("xhtml.reqif"), "utf8")).toContain('data="sketch.png"');
    for (const name of ["string.reqif", "xhtml.reqif"]) {
      expect(await validateReqif(await fs.readFile(fixture.path(name), "utf8"), dir, pins), name).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it("refuses statements without a mapping, a mapping without statement, an element without or with a shared source IDENTIFIER, and a mapping without statements", async () => {
    const { fixture, workspace } = await open({
      "reqif/plain.yaml": "reqseq-reqif-mapping: 1\nsource: { name: Kunde A }\n",
    });
    const codes = async (input: Record<string, unknown>): Promise<unknown[]> => {
      const error = await failure(workspace, { output: "x.reqif", ...input });
      return [error.code, error.details?.["fields"] ?? error.details?.["id"]];
    };
    expect(await codes({ statements: true })).toEqual(["input.invalid", ["mapping"]]);
    expect(await codes({ statements: true, mapping: "reqif/plain.yaml" })).toEqual([
      "input.invalid",
      ["mapping"],
    ]);
    // A mapping without statements is the export of SR-054 AK2 and SR-059, not yet.
    expect(await codes({ mapping: STRING_MAPPING })).toEqual(["input.invalid", ["mapping"]]);
    expect((await failure(workspace, { output: "x.reqif", mapping: STRING_MAPPING })).message).toBe(
      "mapping: not available yet in this version; export a selection without it",
    );
    await fs.writeFile(
      fixture.path("Kunde-A/SR-0000000058a4.md"),
      `---\nid: 58058058-0000-4000-8000-0000000058a4\ntype: system-requirement\nstatus: draft\ntitle: Twice\nsource: Kunde A\nsource-identifier: _cr-1\n---\n`,
    );
    const twice = new Workspace(fixture.root);
    onTestFinished(() => twice.close());
    const shared = await invoke(
      "reqif.export",
      { output: "x.reqif", mapping: STRING_MAPPING, statements: true },
      { workspace: twice },
    ).catch((e: unknown) => e);
    expect([(shared as CommandError).code, (shared as CommandError).details?.["id"]]).toEqual([
      "ref.ambiguous",
      "_cr-1",
    ]);
    await fs.writeFile(
      fixture.path("Kunde-A/SR-0000000058a4.md"),
      `---\nid: 58058058-0000-4000-8000-0000000058a4\ntype: system-requirement\nstatus: draft\ntitle: Unknown\nsource: Kunde A\n---\n`,
    );
    await fs.writeFile(
      fixture.path("Kunde-A/SR-0000000058a5.md"),
      `---\nid: 58058058-0000-4000-8000-0000000058a5\ntype: system-requirement\nstatus: draft\ntitle: Unknown too\nsource: Kunde A\n---\n`,
    );
    const unknown = new Workspace(fixture.root);
    onTestFinished(() => unknown.close());
    const missing = (await invoke(
      "reqif.export",
      { output: "x.reqif", mapping: STRING_MAPPING, statements: true },
      { workspace: unknown },
    ).catch((e: unknown) => e)) as CommandError;
    expect([missing.code, missing.message]).toEqual([
      "input.invalid",
      "Not exported: no source-identifier on SR-0058a4, SR-0058a5 of source Kunde A, so the source cannot match them; leave these elements out of the selection",
    ]);
    await expect(fs.stat(fixture.path("x.reqif"))).rejects.toThrow();
  });

  it("needs the origin meanings source and source-identifier in the metamodel", async () => {
    const model = await fs.readFile(
      new URL("../../../../../fixtures/SR-058/statements/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    for (const meaning of ["source", "source-identifier"]) {
      const { workspace } = await open({
        "metamodel/standard-model.yaml": model.replace(`meaning: ${meaning},`, ""),
      });
      const error = await failure(workspace, {
        output: "x.reqif",
        mapping: STRING_MAPPING,
        statements: true,
      });
      expect([error.code, error.details?.["meaning"]]).toEqual(["metamodel.meaning-unassigned", meaning]);
    }
  });
});
