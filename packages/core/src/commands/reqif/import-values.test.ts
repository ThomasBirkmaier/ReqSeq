// reqif.import (SR-053) of every datatype into every property kind, on SR-085/value-kinds (one property
// per kind) with a text property `note` added: what each value becomes, the losses (SR-053 AK2) and
// the mappings and files the import refuses.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Imported = CommandOutput<"reqif.import">;

/** The origin properties (SR-057), which every type of the import needs. */
const ORIGIN = "source, source-identifier, import-date, delivery, import-version";

const METAMODEL = readFileSync(
  new URL("../../../../../fixtures/SR-085/value-kinds/system/metamodel/model.yaml", import.meta.url),
  "utf8",
)
  .replace(
    "review-dates, platforms, legacy-class]",
    `review-dates, platforms, legacy-class, note, ${ORIGIN}]`,
  )
  .replace("properties: [title], required", `properties: [title, ${ORIGIN}], required`)
  .replace(
    "  - { key: legacy-class",
    [
      "  - { key: note, name: Note, kind: text }",
      "  - { key: source, name: Source, kind: text, meaning: source }",
      "  - { key: source-identifier, name: Source Identifier, kind: text, meaning: source-identifier }",
      "  - { key: import-date, name: Import Date, kind: date, meaning: import-date }",
      "  - { key: delivery, name: Delivery, kind: text, meaning: delivery }",
      "  - { key: import-version, name: Import Version, kind: text, meaning: import-version }",
      "  - { key: legacy-class",
    ].join("\n"),
  );

const datatype = (kind: string, id: string, values: readonly string[] = []): string =>
  values.length === 0
    ? `<DATATYPE-DEFINITION-${kind} IDENTIFIER="${id}"/>`
    : `<DATATYPE-DEFINITION-${kind} IDENTIFIER="${id}"><SPECIFIED-VALUES>${values
        .map(
          (v) =>
            `<ENUM-VALUE IDENTIFIER="${id}-${v}" LONG-NAME="${v}"><PROPERTIES><EMBEDDED-VALUE KEY="0" OTHER-CONTENT=""/></PROPERTIES></ENUM-VALUE>`,
        )
        .join("")}</SPECIFIED-VALUES></DATATYPE-DEFINITION-${kind}>`;

const attribute = (kind: string, id: string, name: string, dt: string): string =>
  `<ATTRIBUTE-DEFINITION-${kind} IDENTIFIER="${id}" LONG-NAME="${name}" MULTI-VALUED="true"><TYPE><DATATYPE-DEFINITION-${kind}-REF>${dt}</DATATYPE-DEFINITION-${kind}-REF></TYPE></ATTRIBUTE-DEFINITION-${kind}>`;

const value = (kind: string, id: string, v: string): string =>
  kind === "ENUMERATION"
    ? `<ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>${id}</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES>${v
        .split(",")
        .filter((ref) => ref !== "")
        .map((ref) => `<ENUM-VALUE-REF>${ref}</ENUM-VALUE-REF>`)
        .join("")}</VALUES></ATTRIBUTE-VALUE-ENUMERATION>`
    : `<ATTRIBUTE-VALUE-${kind} THE-VALUE="${v}"><DEFINITION><ATTRIBUTE-DEFINITION-${kind}-REF>${id}</ATTRIBUTE-DEFINITION-${kind}-REF></DEFINITION></ATTRIBUTE-VALUE-${kind}>`;

const object = (id: string, type: string, values: readonly string[]): string =>
  `<SPEC-OBJECT IDENTIFIER="${id}"><VALUES>${values.join("")}</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>${type}</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>`;

const relation = (id: string, type: string, source: string, target: string, values = ""): string =>
  `<SPEC-RELATION IDENTIFIER="${id}"><VALUES>${values}</VALUES><SOURCE><SPEC-OBJECT-REF>${source}</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>${target}</SPEC-OBJECT-REF></TARGET><TYPE><SPEC-RELATION-TYPE-REF>${type}</SPEC-RELATION-TYPE-REF></TYPE></SPEC-RELATION>`;

const item = (id: string, values: Readonly<Record<string, string>>): string =>
  object(
    id,
    "ot-item",
    Object.entries(values).map(([a, v]) => value(KINDS[a] ?? "STRING", a, v)),
  );

/** The kind of each attribute of type Item. */
const KINDS: Readonly<Record<string, string>> = {
  "a-name": "STRING",
  "a-weight": "REAL",
  "a-count": "INTEGER",
  "a-due": "DATE",
  "a-platforms": "ENUMERATION",
  "a-priority": "ENUMERATION",
  "a-tags": "ENUMERATION",
  "a-note": "ENUMERATION",
  "a-criteria": "STRING",
  "a-body": "STRING",
  "a-reviews": "DATE",
};

const DELIVERY = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"><THE-HEADER><REQ-IF-HEADER IDENTIFIER="h"/></THE-HEADER>',
  "<CORE-CONTENT><REQ-IF-CONTENT><DATATYPES>",
  datatype("STRING", "dt-string"),
  datatype("REAL", "dt-real"),
  datatype("INTEGER", "dt-integer"),
  datatype("DATE", "dt-date"),
  datatype("ENUMERATION", "dt-os", ["Linux", "Windows", "Mac"]),
  datatype("ENUMERATION", "dt-level", ["Low", "High"]),
  "</DATATYPES><SPEC-TYPES>",
  '<SPEC-OBJECT-TYPE IDENTIFIER="ot-item" LONG-NAME="Item"><SPEC-ATTRIBUTES>',
  attribute("STRING", "a-name", "Name", "dt-string"),
  attribute("REAL", "a-weight", "Weight", "dt-real"),
  attribute("INTEGER", "a-count", "Count", "dt-integer"),
  attribute("DATE", "a-due", "Due", "dt-date"),
  attribute("ENUMERATION", "a-platforms", "Platforms", "dt-os"),
  attribute("ENUMERATION", "a-priority", "Priority", "dt-level"),
  attribute("ENUMERATION", "a-tags", "Tags", "dt-level"),
  // O-1 has a Note of its own, the other items get its DEFAULT-VALUE (here without DEFINITION).
  attribute("ENUMERATION", "a-note", "Note", "dt-level").replace(
    "</TYPE>",
    "</TYPE><DEFAULT-VALUE><ATTRIBUTE-VALUE-ENUMERATION><VALUES><ENUM-VALUE-REF>dt-level-Low</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION></DEFAULT-VALUE>",
  ),
  attribute("STRING", "a-criteria", "Criteria", "dt-string"),
  attribute("STRING", "a-body", "Body", "dt-string"),
  attribute("DATE", "a-reviews", "Reviews", "dt-date"),
  "</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>",
  '<SPEC-OBJECT-TYPE IDENTIFIER="ot-skip" LONG-NAME="Skip"/>',
  '<SPEC-OBJECT-TYPE IDENTIFIER="ot-memo" LONG-NAME="Memo"><SPEC-ATTRIBUTES>',
  attribute("STRING", "a-label", "Label", "dt-string"),
  "</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>",
  '<SPEC-RELATION-TYPE IDENTIFIER="rt-trace" LONG-NAME="trace"><SPEC-ATTRIBUTES>',
  attribute("STRING", "ar-why", "Why", "dt-string"),
  "</SPEC-ATTRIBUTES></SPEC-RELATION-TYPE>",
  '<SPEC-RELATION-TYPE IDENTIFIER="rt-skip" LONG-NAME="skip"/>',
  '<SPECIFICATION-TYPE IDENTIFIER="st" LONG-NAME="Spec"><SPEC-ATTRIBUTES>',
  attribute("STRING", "as-title", "Title", "dt-string"),
  "</SPEC-ATTRIBUTES></SPECIFICATION-TYPE>",
  "</SPEC-TYPES><SPEC-OBJECTS>",
  item("O-1", {
    "a-name": "One",
    "a-weight": "1.5",
    "a-due": "2026-11-02T10:30:00+01:00",
    "a-platforms": "dt-os-Linux,dt-os-Windows,dt-os-Mac",
    "a-priority": "dt-level-Low,dt-level-High",
    "a-tags": "dt-level-Low,dt-level-High",
    "a-note": "dt-level-High",
    "a-criteria": "It works.",
    "a-body": "*Measure* the [wind]",
    "a-reviews": "2026-11-05T00:00:00Z",
  }),
  item("O-2", {
    "a-name": "Two",
    "a-weight": "INF",
    "a-due": "2026-11-02T00:00:00Z",
    "a-platforms": "dt-os-Mac",
  }),
  item("O-3", {
    "a-name": "Three",
    "a-count": "7",
    "a-due": "2026-11-03",
    "a-platforms": "dt-os-None",
  }).replace("<VALUES>", '<ALTERNATIVE-ID><ALTERNATIVE-ID IDENTIFIER="x-3"/></ALTERNATIVE-ID><VALUES>'),
  object("S-1", "ot-skip", []),
  object("M-1", "ot-memo", [value("STRING", "a-label", "A memo")]),
  item("O-5", { "a-name": "Five", "a-weight": " ", "a-count": "0x1A" }),
  item("O-6", { "a-name": "Six", "a-count": "99999999999999999999" }),
  "</SPEC-OBJECTS><SPEC-RELATIONS>",
  relation("R-1", "rt-trace", "O-1", "O-2", value("STRING", "ar-why", "Because")).replace(
    "<VALUES>",
    "<EXTRA/><VALUES>",
  ),
  relation("R-2", "rt-trace", "O-1", "O-2"),
  relation("R-3", "rt-trace", "S-1", "O-1").replace("<VALUES>", "<EXTRA/><VALUES>"),
  relation("R-4", "rt-skip", "O-1", "O-3").replace("<VALUES>", "<EXTRA/><VALUES>"),
  relation("R-5", "rt-trace", "M-1", "O-1"),
  "</SPEC-RELATIONS><SPECIFICATIONS>",
  `<SPECIFICATION IDENTIFIER="SP-1" LONG-NAME="Empty"><EXTRA/><VALUES>${value("STRING", "as-title", "Values")}</VALUES><TYPE><SPECIFICATION-TYPE-REF>st</SPECIFICATION-TYPE-REF></TYPE></SPECIFICATION>`,
  "</SPECIFICATIONS></REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>",
  "",
].join("\n");

const MAPPING = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Values }",
  "types:",
  "  - { source: Item, type: system-requirement }",
  "  - { source: ot-skip, omit: true }",
  "  - { source: Memo, type: need }",
  "attributes:",
  "  - { source: Name, property: title }",
  "  - { source: Weight, property: weight }",
  "  - { source: Count, property: weight }",
  "  - { source: Due, property: due }",
  "  - { source: Platforms, property: platforms, values: { Linux: linux, Windows: linux }, omit-values: [Mac] }",
  "  - { source: Priority, property: priority, values: { Low: low, High: high } }",
  "  - { source: Tags, property: acceptance-criteria }",
  "  - { source: Note, property: note }",
  "  - { source: Criteria, property: acceptance-criteria }",
  "  - { source: Body, property: text }",
  "  - { source: Reviews, property: review-dates }",
  "  - { source: Label, property: title }",
  "relations:",
  "  - { source: trace, kind: derives-from }",
  "  - { source: skip, omit: true }",
  "",
].join("\n");

const open = async (mapping = MAPPING, metamodel = METAMODEL, delivery = DELIVERY): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-085/value-kinds",
    files: {
      "system/metamodel/model.yaml": metamodel,
      "system/in/values.reqif": delivery,
      "system/reqif/values.yaml": mapping,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const INPUT = { file: "in/values.reqif", mapping: "reqif/values.yaml", delivery: "1" };

const failure = async (workspace: Workspace): Promise<CommandError> => {
  try {
    await invoke("reqif.import", INPUT, { workspace });
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("reqif.import did not fail");
};

const properties = async (workspace: Workspace, id: string | undefined): Promise<Record<string, unknown>> =>
  ((await invoke("element.get", { ref: id }, { workspace })) as CommandOutput<"element.get">).element
    .properties;

describe("reqif.import of each datatype (SR-053)", () => {
  it("[SR-053/AK2] takes over each value as its property holds it and lists what it leaves out", async () => {
    const workspace = await open();
    const out = (await invoke("reqif.import", INPUT, { workspace })) as Imported;
    const [one, two, three, memo, five] = out.created.map((c) => c.id);
    expect(out.created.map((c) => c.identifier)).toEqual(["O-1", "O-2", "O-3", "M-1", "O-5", "O-6"]);
    expect(await properties(workspace, one)).toMatchObject({
      weight: 1.5,
      due: "2026-11-02",
      "review-dates": ["2026-11-05"],
      platforms: ["linux"],
      priority: "low",
      "acceptance-criteria": ["It works."],
      note: "High",
    });
    expect(await properties(workspace, two)).toMatchObject({ due: "2026-11-02", note: "Low" });
    expect(await properties(workspace, two)).not.toHaveProperty("weight");
    expect(await properties(workspace, two)).not.toHaveProperty("platforms");
    expect(await properties(workspace, three)).toMatchObject({ weight: 7, due: "2026-11-03" });
    expect(await properties(workspace, five)).not.toHaveProperty("weight");
    // A STRING in the Markdown text is escaped, so it reads back as written.
    const text = await fs.readFile(path.join(workspace.root, out.files[0] ?? ""), "utf8");
    expect(text.endsWith("\n\\*Measure\\* the \\[wind\\]\n")).toBe(true);
    const outgoing = (await invoke(
      "element.get",
      { ref: one },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(outgoing.element.relations.map((r) => [r.kind, r.id])).toEqual([["derives-from", two]]);
    const fromMemo = (await invoke(
      "element.get",
      { ref: memo },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect([fromMemo.element.title, fromMemo.element.relations]).toEqual(["A memo", []]);
    expect(out.losses.map((l) => [l.identifier, l.code, l.reason])).toEqual([
      ["O-1", "date-time", "Due: the time of 2026-11-02T10:30:00+01:00 is left out; 2026-11-02 is kept"],
      ["O-1", "omitted-value", "Platforms: the mapping omits the value Mac"],
      ["O-1", "omitted-value", "Priority: priority holds one choice, so high is left out"],
      ["O-2", "omitted-value", "Weight: INF is no finite number"],
      ["O-2", "omitted-value", "Platforms: the mapping omits the value Mac"],
      ["O-3", "omitted-value", "Platforms: the value dt-os-None is not defined in the file"],
      ["S-1", "omitted-type", "the mapping omits its type Skip"],
      ["O-5", "omitted-value", 'Weight: " " is no REAL'],
      ["O-5", "omitted-value", 'Count: "0x1A" is no INTEGER'],
      ["O-6", "omitted-value", "Count: 99999999999999999999 is larger than a number holds exactly"],
      ["R-1", "omitted-attribute", "the values of a SPEC-RELATION are not imported: Why"],
      ["R-2", "relation-duplicate", "derives-from to O-2 is imported once already"],
      ["R-3", "relation-end-not-imported", "its source S-1 is not imported"],
      ["R-4", "omitted-type", "the mapping omits its type skip"],
      [
        "R-5",
        "relation-not-allowed",
        "the metamodel does not allow derives-from from need to system-requirement",
      ],
      ["SP-1", "omitted-attribute", "the values of a SPECIFICATION are not imported: Title"],
      ["O-3", "omitted-value", "<ALTERNATIVE-ID> on line 38 is not read"],
      ["R-1", "omitted-value", "<EXTRA> on line 44 is not read"],
      ["R-3", "omitted-value", "<EXTRA> on line 46 is not read"],
      ["SP-1", "omitted-value", "<EXTRA> on line 50 is not read"],
    ]);
    // A part not read is a loss of the element it belongs to, or of the source of a relation.
    expect(out.losses.filter((l) => l.reason.endsWith("is not read")).map((l) => l.id)).toEqual([
      three,
      one,
      undefined,
      undefined,
    ]);
  });

  it("[SR-053/AK2] leaves out a DATE value that is not an xs:dateTime and lists it in reqif.analyze and reqif.import (#571)", async () => {
    const dates = [
      item("D-1", { "a-name": "Text", "a-due": "aaa", "a-reviews": "" }),
      item("D-2", { "a-name": "Short", "a-due": "2021-7-1", "a-reviews": "2026-02-30T00:00:00Z" }),
      item("D-3", { "a-name": "Late", "a-due": "2026-11-02T25:00:00Z", "a-reviews": "2026-13-01" }),
      item("D-4", { "a-name": "Leap", "a-due": "2024-02-29T23:59:59.5-14:00" }),
      item("D-5", {
        "a-name": "Spaced",
        "a-due": " 2026-01-01T00:00:00Z ",
        "a-reviews": "2026-12-31T24:00:00Z",
      }),
      item("D-6", { "a-name": "Last", "a-due": "9999-12-31T24:00:00Z" }),
    ].join("");
    const workspace = await open(
      MAPPING,
      METAMODEL,
      DELIVERY.replace("</SPEC-OBJECTS>", `${dates}</SPEC-OBJECTS>`),
    );
    // reqif.analyze plans the same import, so it lists the same losses before anything is written.
    const analysis = (await invoke(
      "reqif.analyze",
      { file: INPUT.file, mapping: INPUT.mapping },
      { workspace },
    )) as CommandOutput<"reqif.analyze">;
    const out = (await invoke("reqif.import", INPUT, { workspace })) as Imported;
    const dateLosses = (losses: Imported["losses"]): string[][] =>
      losses.filter((l) => l.identifier.startsWith("D-")).map((l) => [l.identifier, l.code, l.reason]);
    expect(dateLosses(analysis.losses)).toEqual(dateLosses(out.losses));
    const ids = new Map(out.created.map((c) => [c.identifier, c.id]));
    for (const identifier of ["D-1", "D-2", "D-3"]) {
      const written = await properties(workspace, ids.get(identifier));
      expect(written).not.toHaveProperty("due");
      expect(written).not.toHaveProperty("review-dates");
    }
    expect(await properties(workspace, ids.get("D-4"))).toMatchObject({ due: "2024-02-29" });
    // White space around the value is collapsed (xs:dateTime), and 24:00:00 is midnight of the next day.
    expect(await properties(workspace, ids.get("D-5"))).toMatchObject({
      due: "2026-01-01",
      "review-dates": ["2027-01-01"],
    });
    expect(await properties(workspace, ids.get("D-6"))).not.toHaveProperty("due");
    expect(dateLosses(out.losses)).toEqual([
      ["D-1", "omitted-value", 'Due: "aaa" is no DATE'],
      ["D-1", "omitted-value", 'Reviews: "" is no DATE'],
      ["D-2", "omitted-value", 'Due: "2021-7-1" is no DATE'],
      ["D-2", "omitted-value", 'Reviews: "2026-02-30T00:00:00Z" is no DATE'],
      ["D-3", "omitted-value", 'Due: "2026-11-02T25:00:00Z" is no DATE'],
      ["D-3", "omitted-value", 'Reviews: "2026-13-01" is no DATE'],
      ["D-4", "date-time", "Due: the time of 2024-02-29T23:59:59.5-14:00 is left out; 2024-02-29 is kept"],
      ["D-6", "omitted-value", 'Due: "9999-12-31T24:00:00Z" is no DATE'],
    ]);
  });

  it("refuses attributes mapped to properties that cannot hold their datatype", async () => {
    const workspace = await open(
      MAPPING.replace("{ source: Name, property: title }", "{ source: Name, property: weight }")
        .replace("{ source: Weight, property: weight }", "{ source: Weight, property: due }")
        .replace("{ source: Due, property: due }", "{ source: Due, property: parent-item }")
        .replace(
          "{ source: Criteria, property: acceptance-criteria }",
          "{ source: Criteria, property: priority }",
        ),
    );
    const error = await failure(workspace);
    expect([error.code, error.details?.["fields"]]).toEqual([
      "input.invalid",
      [
        "mapping.attributes[0].property",
        "mapping.attributes[1].property",
        "mapping.attributes[3].property",
        "mapping.attributes[8].property",
      ],
    ]);
  });

  it("refuses a mapped status, id or type: the delivery never sets them (D-030)", async () => {
    const metamodel = METAMODEL.replace(
      "review-dates, platforms, legacy-class, note]",
      "review-dates, platforms, legacy-class, note, status]",
    ).replace(
      "  - { key: note, name: Note, kind: text }",
      "  - { key: note, name: Note, kind: text }\n  - { key: status, name: State, kind: text }",
    );
    const workspace = await open(
      MAPPING.replace(
        "{ source: Criteria, property: acceptance-criteria }",
        "{ source: Criteria, property: status }",
      ),
      metamodel,
    );
    const error = await failure(workspace);
    expect([error.code, error.message]).toEqual([
      "input.invalid",
      "mapping.attributes[8].property: property cannot hold status: ReqSeq sets it",
    ]);
  });

  it("refuses a mapped origin property: only the import writes it (SR-057 AK3)", async () => {
    const workspace = await open(MAPPING.replace("property: note }", "property: delivery }"));
    const error = await failure(workspace);
    expect([error.code, error.message]).toEqual([
      "input.invalid",
      "mapping.attributes[7].property: property cannot hold delivery: it holds the origin (delivery), which only reqif.import writes",
    ]);
  });

  it("is reqif.invalid for a value of an attribute the relation's type does not define", async () => {
    const workspace = await open(MAPPING, METAMODEL, DELIVERY.replace(">ar-why<", ">a-name<"));
    const error = await failure(workspace);
    expect([error.code, error.message]).toEqual([
      "reqif.invalid",
      "file: SPEC-RELATION R-1 has a value of attribute a-name, which its type does not define",
    ]);
  });

  it("lists every value and attribute a mapping without them leaves unmapped", async () => {
    const values = await open(MAPPING.replace(", values: { Low: low, High: high } }", " }"));
    expect((await failure(values)).details?.["unmapped"]).toEqual([
      { kind: "value", source: "Low", sourceType: "Item", attribute: "Priority" },
      { kind: "value", source: "High", sourceType: "Item", attribute: "Priority" },
    ]);
    const bare = await open("reqseq-reqif-mapping: 1\nsource: { name: Values }\n");
    // An unmapped type names its attributes too (SR-055 AK2).
    const attributes = (sourceType: string, names: readonly string[]): object[] =>
      names.map((source) => ({ kind: "attribute", source, sourceType }));
    expect((await failure(bare)).details?.["unmapped"]).toEqual([
      { kind: "type", source: "Item" },
      ...attributes("Item", [
        "Name",
        "Weight",
        "Count",
        "Due",
        "Platforms",
        "Priority",
        "Tags",
        "Note",
        "Criteria",
        "Body",
        "Reviews",
      ]),
      { kind: "type", source: "Skip" },
      { kind: "type", source: "Memo" },
      ...attributes("Memo", ["Label"]),
      { kind: "relation", source: "trace" },
      { kind: "relation", source: "skip" },
    ]);
    const typed = await open(
      "reqseq-reqif-mapping: 1\nsource: { name: Values }\ntypes: [{ source: Item, type: need }]\n",
    );
    expect((await failure(typed)).details?.["unmapped"]).toEqual(
      expect.arrayContaining([
        { kind: "attribute", source: "Name", sourceType: "Item" },
        { kind: "type", source: "Skip" },
      ]),
    );
  });

  it("writes into the repository root when the target names it", async () => {
    const workspace = await open(`${MAPPING}target: { repository: system, path: "." }\n`);
    const out = (await invoke("reqif.import", INPUT, { workspace })) as Imported;
    expect(out.files.every((f) => /^(?:SR|N)-[0-9a-f]{12}\.md$/.test(f))).toBe(true);
  });
});
