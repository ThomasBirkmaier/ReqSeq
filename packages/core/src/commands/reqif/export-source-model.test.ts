// reqif.export with sourceModel (SR-158) on SR-004/one-repository after an import of the delivery of
// fixtures/SR-053/delivery through its mapping, which stores the source model (reqif/source-model.ts):
// REQ-1 and REQ-2 of Kunde A (Priority High and Low), the own element of the fixture and one element
// of Kunde B. The metamodel gets a number, a date, a list and a choice with `many` for the datatypes.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { REQIF_XSD_PINS, createFixtureWorkspace, reqifXsdDir, validateReqif } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { parse, stringify } from "yaml";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { ReqifFile } from "../../reqif/model.js";
import { parseReqif } from "../../reqif/parse.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

type Exported = CommandOutput<"reqif.export">;
type Imported = CommandOutput<"reqif.import">;
type Mapping = Record<string, unknown> & {
  attributes: Record<string, unknown>[];
  types: Record<string, unknown>[];
  "source-model": {
    datatypes: (Record<string, unknown> & { identifier: string })[];
    types: (Record<string, unknown> & { identifier: string; attributes: Record<string, unknown>[] })[];
  };
};

const sample = (name: string): string =>
  readFileSync(new URL(`../../../../../fixtures/${name}`, import.meta.url), "utf8");
const MAPPING = "reqif/kunde-a.yaml";
const OWN = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const METAMODEL = sample("SR-004/one-repository/metamodel/standard-model.yaml")
  .replace(
    "        topic,\n      ]",
    "        topic,\n        effort,\n        due,\n        priority,\n        validation-criteria,\n        tags,\n      ]",
  )
  .replace(
    "\nproperties:\n",
    [
      "",
      "properties:",
      '  - { key: effort, name: Effort, description: "Days.", kind: number }',
      '  - { key: due, name: Due, description: "Due date.", kind: date }',
      '  - { key: tags, name: Tags, description: "Tags.", kind: choice, many: true, choices: [{ key: a, name: A }, { key: b, name: B }] }',
      "",
    ].join("\n"),
  );
const KUNDE_B = `---\nid: 15815815-0000-4000-8000-000000000158\ntype: system-requirement\nstatus: draft\ntitle: Of another source\nsource: Kunde B\nsource-identifier: REQ-1\n---\n`;

const open = async (): Promise<{
  fixture: FixtureWorkspace;
  workspace: Workspace;
  ids: Record<string, string>;
  short: Record<string, string>;
  /** The short IDs of REQ-1 and REQ-2 in the order of the list. */
  both: string;
}> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: {
      "in/lieferung.reqif": sample("SR-053/delivery/lieferung.reqif"),
      [MAPPING]: sample("SR-053/delivery/kunde-a.yaml"),
      "metamodel/standard-model.yaml": METAMODEL,
      "Kunde-B/SR-000000000158.md": KUNDE_B,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const imported = (await invoke(
    "reqif.import",
    { file: "in/lieferung.reqif", mapping: MAPPING, delivery: "Lastenheft 2026-11" },
    { workspace },
  )) as Imported;
  const ids = Object.fromEntries(imported.created.map((o) => [o.identifier, o.id ?? ""]));
  const listed = ((await invoke("element.list", {}, { workspace })) as FullList).elements;
  const short = Object.fromEntries(
    Object.entries(ids).map(([identifier, id]) => [
      identifier,
      listed.find((e) => e.id === id)?.shortId ?? "",
    ]),
  );
  const both = listed.flatMap((e) => (Object.values(ids).includes(e.id) ? [e.shortId] : [])).join(", ");
  return { fixture, workspace, ids, short, both };
};

const run = async (workspace: Workspace, input: Record<string, unknown>): Promise<Exported> =>
  (await invoke(
    "reqif.export",
    { output: "back.reqif", mapping: MAPPING, sourceModel: true, ...input },
    {
      workspace,
    },
  )) as Exported;

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

const update = (workspace: Workspace, ref: string, set: Record<string, unknown>): Promise<unknown> =>
  invoke("element.update", { ref, set }, { workspace });

const editMapping = async (fixture: FixtureWorkspace, edit: (mapping: Mapping) => void): Promise<void> => {
  const mapping = parse(await fs.readFile(fixture.path(MAPPING), "utf8")) as Mapping;
  edit(mapping);
  await fs.writeFile(fixture.path(MAPPING), stringify(mapping));
};

/** `fixture`'s mapping with an attribute of `datatype` on Customer Requirement, mapped to `property`. */
const withAttribute = (
  fixture: FixtureWorkspace,
  name: string,
  datatype: Record<string, unknown> & { identifier: string },
  entry: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> =>
  editMapping(fixture, (m) => {
    m["source-model"].datatypes.push(datatype);
    m["source-model"].types[0]?.attributes.push({
      identifier: `ad-${name}`,
      "long-name": name,
      datatype: datatype.identifier,
      ...extra,
    });
    m.attributes.push({ source: name, ...entry });
  });

const parsed = async (fixture: FixtureWorkspace, name = "back.reqif"): Promise<ReqifFile> => {
  const outcome = parseReqif(await fs.readFile(fixture.path(name)));
  if (outcome.kind !== "parsed") {
    throw new Error(outcome.message);
  }
  return outcome.file;
};

/** Each object as its IDENTIFIER and its values as definition and value. */
const objects = (file: ReqifFile): unknown[] =>
  file.specObjects.map((o) => [
    o.identifier,
    o.values.map((v) => [
      v.definition,
      v.kind === "enumeration" ? v.values : v.kind === "xhtml" ? JSON.stringify(v.value) : v.value,
    ]),
  ]);

const exists = (fixture: FixtureWorkspace, name: string): Promise<boolean> =>
  fs.access(fixture.path(name)).then(
    () => true,
    () => false,
  );

describe("reqif.export with sourceModel (SR-158)", () => {
  it("[SR-158/AK-rpq1] writes the source's types, attributes and datatypes with their IDENTIFIER and LONG-NAME, and each requirement with its source IDENTIFIER", async () => {
    const { fixture, workspace, short } = await open();
    const out = await run(workspace, {});
    expect(out).toEqual({
      answer: "Exported 2 elements and 0 relations to back.reqif.",
      file: "back.reqif",
      elements: 2,
      relations: 0,
      exportedElements: expect.any(Array) as unknown,
      elementsWithoutStatement: [],
      files: [],
      problems: [],
    });
    // The number names its elements (SR-224 AK4).
    expect(out.exportedElements.map((e) => e.shortId).sort()).toEqual(Object.values(short).sort());
    const file = await parsed(fixture);
    expect(file.header.toolId).toBe("reqseq-source-model");
    expect(
      file.specTypes.map((t) => [
        t.identifier,
        t.longName,
        t.attributes.map((a) => [a.identifier, a.longName, a.datatype]),
      ]),
    ).toEqual([
      [
        "ot-req",
        "Customer Requirement",
        [
          ["ad-name", "ReqIF.Name", "dt-string"],
          ["ad-text", "ReqIF.Text", "dt-xhtml"],
          ["ad-priority", "Priority", "dt-priority"],
          ["ad-comment", "Internal Comment", "dt-string"],
        ],
      ],
      ["_st-specification", "specification", []],
    ]);
    expect(
      file.datatypes.map((d) => [
        d.identifier,
        d.kind,
        d.maxLength,
        d.values.map((v) => [v.identifier, v.longName, v.key]),
      ]),
    ).toEqual([
      ["dt-string", "string", "1000", []],
      ["dt-xhtml", "xhtml", undefined, []],
      [
        "dt-priority",
        "enumeration",
        undefined,
        [
          ["ev-high", "High", "1"],
          ["ev-low", "Low", "2"],
        ],
      ],
    ]);
    expect(file.specObjects.map((o) => [o.identifier, o.longName, o.type]).sort()).toEqual([
      ["REQ-1", undefined, "ot-req"],
      ["REQ-2", undefined, "ot-req"],
    ]);
  });

  it("[SR-158/AK-bccw] writes a choice as the source's enumeration value the mapping maps it to, without and with statements", async () => {
    const { fixture, workspace } = await open();
    await run(workspace, {});
    const values = (file: ReqifFile): unknown[] =>
      file.specObjects
        .map((o) => [o.identifier, o.values.flatMap((v) => (v.kind === "enumeration" ? [v.values] : []))])
        .sort();
    expect(values(await parsed(fixture))).toEqual([
      ["REQ-1", [["ev-high"]]],
      ["REQ-2", [["ev-low"]]],
    ]);
    // A choice as the statement goes into the attribute the mapping names, by the same rule.
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "requirement-type", attribute: "Priority" };
    });
    const out = await run(workspace, { statements: true });
    expect(out.withoutStatement).toBe(0);
    expect(objects(await parsed(fixture)).sort()).toEqual([
      ["REQ-1", [["ad-priority", ["ev-high"]]]],
      ["REQ-2", [["ad-priority", ["ev-low"]]]],
    ]);
  });

  it("[SR-158/AK-b63m] writes the statement into the source's attribute the mapping names, and no other value", async () => {
    const { fixture, workspace, ids } = await open();
    await update(workspace, ids["REQ-1"] ?? "", { statement: "Agreed, **once** per second." });
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "statement", attribute: "ad-comment", datatype: "xhtml" };
    });
    const out = await run(workspace, { statements: true });
    expect([out.elements, out.withoutStatement]).toEqual([2, 1]);
    expect(out.elementsWithoutStatement.map((e) => e.id)).toEqual([ids["REQ-2"]]);
    // STRING by the source's datatype, not XHTML as `statement.datatype` says, the plain text as
    // written; an empty one for REQ-2.
    expect(objects(await parsed(fixture)).sort()).toEqual([
      ["REQ-1", [["ad-comment", "Agreed, **once** per second."]]],
      ["REQ-2", [["ad-comment", ""]]],
    ]);
    // A choice statement into STRING by the names of its choices, a list joined (SR-058 AK1).
    await update(workspace, ids["REQ-1"] ?? "", { tags: ["a", "b"] });
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "tags", attribute: "Internal Comment" };
    });
    await run(workspace, { statements: true, selection: { ids: [ids["REQ-1"]] } });
    expect(objects(await parsed(fixture))).toEqual([["REQ-1", [["ad-comment", "A, B"]]]]);
  });

  it("[SR-158/AK-qgcj] writes an export in the source's model valid against the ReqIF 1.2 schema, without and with statements", async (context) => {
    const { fixture, workspace, ids } = await open();
    await update(workspace, ids["REQ-1"] ?? "", { statement: "Agreed." });
    await run(workspace, { output: "plain.reqif" });
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "statement", attribute: "Internal Comment" };
    });
    await run(workspace, { output: "statements.reqif", statements: true });
    const dir = reqifXsdDir(context, process.env);
    const pins = await fs.readFile(REQIF_XSD_PINS, "utf8");
    for (const name of ["plain.reqif", "statements.reqif"]) {
      expect(await validateReqif(await fs.readFile(fixture.path(name), "utf8"), dir, pins), name).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it("[SR-158/AK-z33h] without sourceModel the export stays a file of ReqSeq, with and without statements", async () => {
    const { fixture, workspace } = await open();
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "statement", attribute: "Internal Comment" };
    });
    const mask = (text: string): string =>
      text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, "T").replace(/_hd-[0-9a-f-]{36}/g, "H");
    for (const today of [{ mapping: MAPPING }, { mapping: MAPPING, statements: true }]) {
      // The call as it was before sourceModel, and with sourceModel not chosen.
      await invoke("reqif.export", { output: "before.reqif", ...today }, { workspace });
      await invoke("reqif.export", { output: "after.reqif", ...today, sourceModel: false }, { workspace });
      const statements = "statements" in today;
      const before = await fs.readFile(fixture.path("before.reqif"), "utf8");
      expect(mask(await fs.readFile(fixture.path("after.reqif"), "utf8"))).toBe(mask(before));
      expect((await parsed(fixture, "after.reqif")).header.toolId).toBe("reqseq");
      expect(before).toContain(statements ? "_ot-statement" : "reqseq-values");
    }
  });

  it("[SR-158/AK-kz13] writes title, text and properties into their source attributes, no value for an omitted property or an empty one, only the source's elements and no SPEC-RELATION", async () => {
    const { fixture, workspace, ids } = await open();
    await update(workspace, ids["REQ-2"] ?? "", { statement: "Later." });
    const out = await run(workspace, { omitProperties: ["requirement-type"] });
    // The omitted property is saved in the mapping, after the output.
    expect([out.elements, out.relations, out.files]).toEqual([2, 0, [MAPPING]]);
    const file = await parsed(fixture);
    const order = ((await invoke("element.list", {}, { workspace })) as FullList).elements.flatMap((e) =>
      e.id === ids["REQ-1"] ? ["REQ-1"] : e.id === ids["REQ-2"] ? ["REQ-2"] : [],
    );
    const text: Record<string, string> = {
      "REQ-1":
        '[{"name":"div","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":[{"name":"p","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":["The station ",{"name":"strong","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":["shall"]}," measure the wind speed."]},{"name":"p","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":["Every 10 s."]}]}]',
      "REQ-2":
        '[{"name":"div","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":[{"name":"p","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":["The display shows the wind speed."]}]}]',
    };
    const title: Record<string, string> = { "REQ-1": "Measure the wind", "REQ-2": "Show the wind" };
    // Priority is omitted and Internal Comment is not mapped: no value, the definitions stay.
    expect(objects(file)).toEqual(
      order.map((identifier) => [
        identifier,
        [
          ["ad-name", title[identifier]],
          ["ad-text", text[identifier]],
        ],
      ]),
    );
    expect(file.specTypes[0]?.attributes.map((a) => a.longName)).toContain("Priority");
    expect(file.specRelations).toEqual([]);
    expect(file.specifications[0]?.children.map((c) => c.object)).toEqual(order);
    // An empty text has no value; the selection narrows the export, and the relation of REQ-2 to
    // REQ-1, left out, is no SPEC-RELATION either.
    const got = (await invoke("element.get", { ref: ids["REQ-2"] }, { workspace })) as { fileSha256: string };
    await invoke(
      "element.update",
      { ref: ids["REQ-2"], text: "", expectedFileSha256: got.fileSha256 },
      { workspace },
    );
    const narrowed = await run(workspace, {
      selection: { ids: [ids["REQ-2"], OWN, "15815815-0000-4000-8000-000000000158"] },
    });
    expect(narrowed.elements).toBe(1);
    const one = await parsed(fixture);
    expect(objects(one)).toEqual([["REQ-2", [["ad-name", "Show the wind"]]]]);
    expect(one.specRelations).toEqual([]);
  });

  it("[SR-158/AK-nxcq] refuses an ambiguous mapping, a value that does not fit its attribute and a type without the statement attribute, names every requirement with attribute or type, and writes nothing", async () => {
    const { fixture, workspace, ids, short, both } = await open();
    const original = await fs.readFile(fixture.path(MAPPING), "utf8");
    const refused = async (message: string, input: Record<string, unknown> = {}): Promise<void> => {
      const error = await failure(workspace, { omitProperties: ["topic"], ...input });
      // Each reason with its requirements, in the order of the elements.
      const prefix = "Not exported in the source's model: ";
      const parts = (text: string): string[] => text.split("; ").sort();
      expect([
        error.code,
        error.message.startsWith(prefix),
        parts(error.message.slice(prefix.length)),
      ]).toEqual(["input.invalid", true, parts(message)]);
      expect(await exists(fixture, "back.reqif")).toBe(false);
    };
    // Two attributes of one type map to the title.
    await editMapping(fixture, (m) => {
      m.attributes = m.attributes.map((e) =>
        e["source"] === "Internal Comment" ? { source: "Internal Comment", property: "title" } : e,
      );
    });
    await refused(
      `${both}: attributes ReqIF.Name, Internal Comment of Customer Requirement all map to title`,
    );
    // Two types of the source map to one type.
    await fs.writeFile(fixture.path(MAPPING), original);
    await editMapping(fixture, (m) => {
      m.types.push({ source: "ot-other", type: "system-requirement" });
      m["source-model"].types.push({ identifier: "ot-other", attributes: [] });
    });
    await refused(
      `${both}: types Customer Requirement, ot-other of the source all map to system-requirement`,
    );
    // A value longer than MAX-LENGTH, and a choice no enumeration value is mapped to.
    await fs.writeFile(fixture.path(MAPPING), original);
    await editMapping(fixture, (m) => {
      m["source-model"].datatypes[0] = { identifier: "dt-string", kind: "string", "max-length": "13" };
    });
    await update(workspace, ids["REQ-2"] ?? "", { "requirement-type": "performance" });
    await refused(
      `${short["REQ-1"] ?? ""}: ReqIF.Name of Customer Requirement: 16 characters are longer than 13, the MAX-LENGTH of dt-string; ${short["REQ-2"] ?? ""}: Priority of Customer Requirement: performance is mapped to no value of dt-priority`,
    );
    // A number greater than MAX or smaller than MIN.
    await fs.writeFile(fixture.path(MAPPING), original);
    await withAttribute(
      fixture,
      "Effort",
      { identifier: "dt-effort", kind: "integer", min: "1", max: "10" },
      { property: "effort" },
    );
    await update(workspace, ids["REQ-1"] ?? "", { effort: 11, "requirement-type": "functional" });
    await update(workspace, ids["REQ-2"] ?? "", { effort: 0, "requirement-type": "functional" });
    await refused(
      `${short["REQ-1"] ?? ""}: Effort of Customer Requirement: 11 is greater than 10, the MAX of dt-effort; ${short["REQ-2"] ?? ""}: Effort of Customer Requirement: 0 is smaller than 1, the MIN of dt-effort`,
    );
    // Any other value that does not fit its attribute: a fraction into INTEGER, a text that is no
    // BOOLEAN, DATE or REAL, a number into STRING, several values into STRING or a single-valued
    // enumeration, a text no enumeration value names, a relation.
    const one = { selection: { ids: [ids["REQ-1"]] } };
    const r1 = short["REQ-1"] ?? "";
    const reset = (): Promise<void> => fs.writeFile(fixture.path(MAPPING), original);
    const misfit = async (
      name: string,
      datatype: Record<string, unknown> & { identifier: string },
      property: string,
      set: Record<string, unknown>,
      reason: string,
    ): Promise<void> => {
      await reset();
      await update(workspace, ids["REQ-1"] ?? "", set);
      await withAttribute(fixture, name, datatype, { property });
      const error = await failure(workspace, one);
      expect(error.message, name).toBe(
        `Not exported in the source's model: ${r1}: ${name} of Customer Requirement: ${reason}`,
      );
    };
    await misfit(
      "Effort",
      { identifier: "dt-int", kind: "integer", min: "0", max: "9" },
      "effort",
      { effort: 2.5 },
      "2.5 is no INTEGER of dt-int",
    );
    await misfit(
      "Flag",
      { identifier: "dt-bool", kind: "boolean" },
      "topic",
      { topic: "yes" },
      "yes is no BOOLEAN of dt-bool",
    );
    await misfit(
      "Day",
      { identifier: "dt-date", kind: "date" },
      "topic",
      { topic: "soon" },
      "soon is no DATE of dt-date",
    );
    await misfit(
      "Width",
      { identifier: "dt-real", kind: "real", min: "0", max: "9", accuracy: "1" },
      "topic",
      { topic: "wide" },
      "wide is no REAL of dt-real",
    );
    await misfit(
      "Days",
      { identifier: "dt-flag", kind: "boolean" },
      "effort",
      { effort: 3 },
      "a number value does not fit BOOLEAN dt-flag",
    );
    await misfit(
      "Day",
      { identifier: "dt-date", kind: "date" },
      "topic",
      { topic: "2024-13-45" },
      "2024-13-45 is no DATE of dt-date",
    );
    await misfit(
      "Checks",
      { identifier: "dt-text", kind: "string", "max-length": "9" },
      "validation-criteria",
      { "validation-criteria": ["x", "y"] },
      "2 values do not fit STRING dt-text, which holds one",
    );
    await misfit(
      "Choice",
      { identifier: "dt-none", kind: "enumeration" },
      "topic",
      { topic: "x" },
      "x is mapped to no value of dt-none",
    );
    await misfit(
      "Links",
      { identifier: "dt-text", kind: "string", "max-length": "99" },
      "packages",
      { packages: [OWN] },
      "a relation value does not fit STRING dt-text",
    );
    await reset();
    await update(workspace, ids["REQ-1"] ?? "", { tags: ["a", "b"] });
    await withAttribute(
      fixture,
      "Tag",
      {
        identifier: "dt-tags",
        kind: "enumeration",
        values: [
          { identifier: "ev-a", "long-name": "A", key: "1", "other-content": "" },
          { identifier: "ev-b", "long-name": "B", key: "2", "other-content": "" },
        ],
      },
      { property: "tags", values: { "ev-a": "a", "ev-b": "b" } },
    );
    expect((await failure(workspace, one)).message).toBe(
      `Not exported in the source's model: ${r1}: Tag of Customer Requirement: 2 values do not fit the single-valued Tag`,
    );
    await reset();
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "statement", attribute: "Supplier Statement" };
    });
    // A type without the statement attribute, for every requirement of it, also one without a statement.
    await refused(
      `${both}: Customer Requirement of the source has no attribute Supplier Statement for the statement`,
      {
        statements: true,
        omitProperties: [],
      },
    );
    // Two attributes match the statement attribute: not unique.
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "statement", attribute: "Internal Comment" };
      m["source-model"].types[0]?.attributes.push({ identifier: "Internal Comment", datatype: "dt-string" });
    });
    await refused(
      `${both}: attributes ad-comment, Internal Comment of Customer Requirement all match Internal Comment, the attribute of the statement`,
      { statements: true, omitProperties: [] },
    );
    // A choice statement takes only the values of an entry of its own property, not those of Priority.
    await reset();
    await update(workspace, ids["REQ-1"] ?? "", { priority: "high" });
    await editMapping(fixture, (m) => {
      m["statement"] = { property: "priority", attribute: "Priority" };
    });
    expect((await failure(workspace, { ...one, statements: true })).message).toBe(
      `Not exported in the source's model: ${r1}: Priority of Customer Requirement: high is mapped to no value of dt-priority`,
    );
    // Nothing written: neither the file nor the omitted property in the mapping.
    expect(await fs.readFile(fixture.path(MAPPING), "utf8")).not.toContain("omit-properties");
  });

  it("writes each kind by the source's datatype", async () => {
    const { fixture, workspace, ids } = await open();
    const one = { selection: { ids: [ids["REQ-1"]] } };
    const values = async (input: Record<string, unknown> = one): Promise<unknown> => {
      await run(workspace, input);
      return objects(await parsed(fixture))[0];
    };
    const original = await fs.readFile(fixture.path(MAPPING), "utf8");
    const reset = (): Promise<void> => fs.writeFile(fixture.path(MAPPING), original);
    const omitted = { omitProperties: ["requirement-type"] };
    // A number into REAL and INTEGER, a date into DATE, a list of choices into a multi-valued
    // enumeration, a text into BOOLEAN, ENUMERATION by name, INTEGER, REAL, DATE and XHTML.
    await update(workspace, ids["REQ-1"] ?? "", {
      effort: 2.5,
      due: "2026-12-01",
      tags: ["a", "b"],
      topic: "true",
    });
    await withAttribute(
      fixture,
      "Effort",
      { identifier: "dt-real", kind: "real", min: "0", max: "9", accuracy: "2" },
      { property: "effort" },
    );
    await withAttribute(fixture, "Due", { identifier: "dt-date", kind: "date" }, { property: "due" });
    await withAttribute(
      fixture,
      "Tags",
      {
        identifier: "dt-tags",
        kind: "enumeration",
        values: [
          { identifier: "ev-a", "long-name": "A", key: "1", "other-content": "" },
          { identifier: "ev-b", "long-name": "B", key: "2", "other-content": "" },
        ],
      },
      { property: "tags", values: { "ev-a": "a", "ev-b": "b" } },
      { "multi-valued": true },
    );
    await withAttribute(fixture, "Flag", { identifier: "dt-bool", kind: "boolean" }, { property: "topic" });
    expect(await values({ ...one, ...omitted })).toEqual([
      "REQ-1",
      [
        ["ad-name", "Measure the wind"],
        ["ad-text", expect.stringContaining("Every 10 s.") as unknown],
        ["ad-Effort", "2.5"],
        ["ad-Due", "2026-12-01T00:00:00Z"],
        ["ad-Tags", ["ev-a", "ev-b"]],
        ["ad-Flag", "true"],
      ],
    ]);
    // A text into an ENUMERATION by name, INTEGER, REAL, DATE, XHTML (plain) and STRING (Markdown).
    await reset();
    await update(workspace, ids["REQ-1"] ?? "", { topic: "High" });
    await withAttribute(
      fixture,
      "Topic",
      { identifier: "dt-priority", kind: "enumeration" },
      { property: "topic" },
    );
    await editMapping(fixture, (m) => {
      m["source-model"].datatypes.pop();
      m.attributes = m.attributes.map((e) =>
        e["source"] === "ReqIF.Text" ? { source: "ReqIF.Text", omit: true } : e,
      );
    });
    expect(await values({ ...one, ...omitted })).toEqual([
      "REQ-1",
      [
        ["ad-name", "Measure the wind"],
        ["ad-Topic", ["ev-high"]],
      ],
    ]);
    for (const [kind, topic, written] of [
      ["integer", "-42", "-42"],
      ["real", "1.5e3", "1.5e3"],
      ["integer", "123456789012345678901234567890", "123456789012345678901234567890"],
      ["real", "NaN", "NaN"],
      ["date", "2026-01-31", "2026-01-31T00:00:00Z"],
      // As the import keeps a DATE in a text property.
      ["date", "2026-12-01T00:00:00Z", "2026-12-01T00:00:00Z"],
      [
        "xhtml",
        "a *b*",
        '[{"name":"div","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":["a *b*"]}]',
      ],
    ] as const) {
      await reset();
      await update(workspace, ids["REQ-1"] ?? "", { topic });
      await withAttribute(
        fixture,
        "Topic",
        {
          identifier: `dt-topic-${kind}`,
          kind,
          ...(kind === "integer"
            ? { min: "-100", max: "999999999999999999999999999999" }
            : kind === "real"
              ? { min: "-1e9", max: "1e9", accuracy: "3" }
              : {}),
        },
        { property: "topic" },
      );
      expect(await values({ ...one, ...omitted }), kind).toEqual([
        "REQ-1",
        [["ad-name", "Measure the wind"], expect.anything(), ["ad-Topic", written]],
      ]);
    }
    // A number into STRING and a date into XHTML as text; a Markdown text and the names a
    // single-valued text property joins into ENUMERATION by name.
    await reset();
    await update(workspace, ids["REQ-1"] ?? "", {
      effort: 3,
      due: "2026-12-01",
      rationale: "Low\\_risk",
      topic: "A, B",
    });
    await withAttribute(
      fixture,
      "Days",
      { identifier: "dt-days", kind: "string", "max-length": "9" },
      { property: "effort" },
    );
    await withAttribute(fixture, "When", { identifier: "dt-when", kind: "xhtml" }, { property: "due" });
    await withAttribute(
      fixture,
      "Risk",
      {
        identifier: "dt-risk",
        kind: "enumeration",
        values: [{ identifier: "ev-risk", "long-name": "Low_risk", key: "1", "other-content": "" }],
      },
      { property: "rationale" },
    );
    await withAttribute(
      fixture,
      "Both",
      {
        identifier: "dt-both",
        kind: "enumeration",
        values: [
          { identifier: "ev-a", "long-name": "A", key: "1", "other-content": "" },
          { identifier: "ev-b", "long-name": "B", key: "2", "other-content": "" },
        ],
      },
      { property: "topic" },
      { "multi-valued": true },
    );
    await editMapping(fixture, (m) => {
      m.attributes = m.attributes.filter((e) => e["source"] !== "ReqIF.Text");
    });
    expect(await values({ ...one, ...omitted })).toEqual([
      "REQ-1",
      [
        ["ad-name", "Measure the wind"],
        ["ad-Days", "3"],
        [
          "ad-When",
          '[{"name":"div","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":["2026-12-01"]}]',
        ],
        ["ad-Risk", ["ev-risk"]],
        ["ad-Both", ["ev-a", "ev-b"]],
      ],
    ]);
    // The text as plain text into STRING, a list into XHTML refused, a relation refused.
    await reset();
    await editMapping(fixture, (m) => {
      m.attributes = m.attributes.map((e) =>
        e["source"] === "Internal Comment"
          ? { source: "Internal Comment", property: "text" }
          : e["source"] === "ReqIF.Text"
            ? { source: "ReqIF.Text", property: "rationale" }
            : e,
      );
    });
    await update(workspace, ids["REQ-1"] ?? "", { rationale: "Because. ![sketch](sketch.png)" });
    expect(await values({ ...one, ...omitted })).toEqual([
      "REQ-1",
      [
        ["ad-name", "Measure the wind"],
        ["ad-text", expect.stringContaining('"data","sketch.png"') as unknown],
        ["ad-comment", "The station shall measure the wind speed.\n\nEvery 10 s."],
      ],
    ]);
  });

  it("writes the first of several source values for a choice with a warning, and an empty statement by the datatype", async () => {
    const { fixture, workspace, ids, short } = await open();
    await editMapping(fixture, (m) => {
      m.attributes = m.attributes.map((e) =>
        e["source"] === "Priority"
          ? { ...e, values: { Low: "quality", High: "functional", "ev-high": "functional" } }
          : e,
      );
      m["source-model"].datatypes[2] = {
        identifier: "dt-priority",
        kind: "enumeration",
        values: [
          { identifier: "ev-high", "long-name": "High", key: "1", "other-content": "" },
          { identifier: "ev-low", "long-name": "Low", key: "2", "other-content": "" },
          { identifier: "ev-top", "long-name": "High", key: "3", "other-content": "" },
        ],
      };
    });
    const out = await run(workspace, { selection: { ids: [ids["REQ-1"]] } });
    expect(out.problems).toEqual([
      {
        code: "reqif.source-value-chosen",
        severity: "warning",
        message: `${short["REQ-1"] ?? ""}: Priority: choice functional is mapped to several values of dt-priority; High is written`,
      },
    ]);
    expect(objects(await parsed(fixture))[0]).toEqual([
      "REQ-1",
      expect.arrayContaining([["ad-priority", ["ev-high"]]]),
    ]);
    // One value named by IDENTIFIER and by LONG-NAME is one value: no warning. A warning per item
    // of a multi-valued choice.
    await editMapping(fixture, (m) => {
      m["source-model"].datatypes[2] = {
        identifier: "dt-priority",
        kind: "enumeration",
        values: [
          { identifier: "ev-high", "long-name": "High", key: "1", "other-content": "" },
          { identifier: "ev-low", "long-name": "Low", key: "2", "other-content": "" },
        ],
      };
    });
    await update(workspace, ids["REQ-1"] ?? "", { tags: ["a", "b"] });
    await withAttribute(
      fixture,
      "Tags",
      {
        identifier: "dt-tags",
        kind: "enumeration",
        values: [
          { identifier: "ev-a", "long-name": "A", key: "1", "other-content": "" },
          { identifier: "ev-a2", "long-name": "A", key: "2", "other-content": "" },
          { identifier: "ev-b", "long-name": "B", key: "3", "other-content": "" },
          { identifier: "ev-b2", "long-name": "B", key: "4", "other-content": "" },
        ],
      },
      { property: "tags", values: { A: "a", B: "b" } },
      { "multi-valued": true },
    );
    const again = await run(workspace, { selection: { ids: [ids["REQ-1"]] } });
    expect((again.problems ?? []).map((p) => p.message)).toEqual([
      `${short["REQ-1"] ?? ""}: Tags: choice a is mapped to several values of dt-tags; A is written`,
      `${short["REQ-1"] ?? ""}: Tags: choice b is mapped to several values of dt-tags; B is written`,
    ]);
    expect(objects(await parsed(fixture))[0]).toEqual([
      "REQ-1",
      expect.arrayContaining([["ad-Tags", ["ev-a", "ev-b"]]]),
    ]);
    // Without a statement: an XHTML and an ENUMERATION attribute get an empty value, an INTEGER none.
    for (const [attribute, empty] of [
      [
        "ReqIF.Text",
        [
          [
            "ad-text",
            '[{"name":"div","namespace":"http://www.w3.org/1999/xhtml","attributes":[],"children":[]}]',
          ],
        ],
      ],
      ["Priority", [["ad-priority", []]]],
      ["Effort", []],
    ] as const) {
      if (attribute === "Effort") {
        await withAttribute(
          fixture,
          "Effort",
          { identifier: "dt-int", kind: "integer", min: "0", max: "9" },
          { property: "effort" },
        );
      }
      await editMapping(fixture, (m) => {
        m["statement"] = { property: "statement", attribute };
      });
      const back = await run(workspace, { statements: true, selection: { ids: [ids["REQ-1"]] } });
      expect([back.withoutStatement, objects(await parsed(fixture))[0]], attribute).toEqual([
        1,
        ["REQ-1", empty],
      ]);
    }
  });

  it("refuses without a mapping, without a source model, and for an element whose type no source type maps to", async () => {
    const { fixture, workspace, both } = await open();
    const noMapping = await failure(workspace, { mapping: undefined });
    expect([noMapping.code, noMapping.details?.["fields"]]).toEqual(["input.invalid", ["mapping"]]);
    await editMapping(fixture, (m) => {
      m.types = [
        { source: "Customer Requirement", type: "use-case" },
        { source: "Heading", omit: true },
      ];
    });
    expect((await failure(workspace, {})).message).toBe(
      `Not exported: no type of the source's model maps to the type of ${both.replaceAll(",", " (system-requirement),")} (system-requirement); import a delivery of that type through the mapping first, or leave these elements out`,
    );
    await fs.writeFile(fixture.path("reqif/bare.yaml"), sample("SR-053/delivery/kunde-a.yaml"));
    const bare = await failure(workspace, { mapping: "reqif/bare.yaml" });
    expect([bare.code, bare.message]).toEqual([
      "input.invalid",
      "mapping: reqif/bare.yaml holds no source model; import a delivery of the source through this mapping first",
    ]);
    // A copy of an element with its UUID but another source IDENTIFIER.
    const [first] = (await fs.readdir(fixture.path("Kunde-A"))).filter((f) => f.endsWith(".md"));
    const copy = (await fs.readFile(fixture.path(`Kunde-A/${first ?? ""}`), "utf8")).replace(
      /source-identifier: .*/,
      "source-identifier: REQ-9",
    );
    await fs.writeFile(fixture.path("Kunde-A/SR-copy.md"), copy);
    const twice = new Workspace(fixture.root);
    onTestFinished(() => twice.close());
    const shared = await invoke(
      "reqif.export",
      { output: "back.reqif", mapping: MAPPING, sourceModel: true },
      { workspace: twice },
    ).catch((error: unknown) => error);
    expect((shared as CommandError).code).toBe("ref.ambiguous");
    await fs.rm(fixture.path("Kunde-A/SR-copy.md"));
    // The message names the first five reasons; details.refusals has all of them.
    await editMapping(fixture, (m) => {
      m.types = [{ source: "Customer Requirement", type: "system-requirement" }];
    });
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await withAttribute(
        fixture,
        `N${String(n)}`,
        { identifier: `dt-n${String(n)}`, kind: "boolean" },
        { property: "title" },
      );
    }
    const many = await failure(workspace, {});
    expect(many.message).toMatch(/; and 8 more$/);
    expect((many.details?.["refusals"] as unknown[]).length).toBe(13);
  });

  it("takes an attribute entry with source-type first, leaves out a stored type no longer mapped, writes no value without attribute entries, and refuses what the writer refuses", async () => {
    const { fixture, workspace, ids } = await open();
    const one = { selection: { ids: [ids["REQ-1"]] }, omitProperties: ["requirement-type"] };
    await update(workspace, ids["REQ-1"] ?? "", { topic: "Wind" });
    await editMapping(fixture, (m) => {
      m.attributes.unshift(
        { "source-type": "Heading", source: "ReqIF.Name", property: "rationale" },
        { "source-type": "ot-req", source: "ReqIF.Name", property: "topic" },
      );
      m.attributes = m.attributes.filter((e) => e["source"] !== "ReqIF.Text");
      // A stored type no types entry maps any more is not written.
      m["source-model"].types.push({ identifier: "ot-old", attributes: [] });
    });
    await run(workspace, one);
    expect(objects(await parsed(fixture))).toEqual([["REQ-1", [["ad-name", "Wind"]]]]);
    await editMapping(fixture, (m) => {
      delete (m as Partial<Mapping>).attributes;
    });
    await run(workspace, one);
    expect(objects(await parsed(fixture))).toEqual([["REQ-1", []]]);
    // An enumeration value stored without KEY and OTHER-CONTENT, which ReqIF 1.2 makes mandatory.
    await editMapping(fixture, (m) => {
      m["source-model"].datatypes[2] = {
        identifier: "dt-priority",
        kind: "enumeration",
        values: [{ identifier: "ev-x", "long-name": "X" }],
      };
    });
    const error = await failure(workspace, one);
    expect([error.code, error.message]).toEqual([
      "reqif.invalid",
      "Not exported: ev-x: KEY is missing; ev-x: OTHER-CONTENT is missing",
    ]);
    expect(await exists(fixture, "back.reqif")).toBe(true);
  });
});
