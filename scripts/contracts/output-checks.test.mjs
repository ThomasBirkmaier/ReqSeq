import { describe, expect, it } from "vitest";
import { loadContracts } from "./load.mjs";
import { SHOWS_OUTPUT, checkOutputs } from "./output-checks.mjs";
import {
  TECHNICAL_DEFINITIONS,
  outputFieldsOf,
  resolvedOutputFields,
  technicalOf,
} from "./output-fields.mjs";

// A common.schema.json with every technical definition, an incomplete flag and a problem.
const technicalDefs = Object.fromEntries(
  TECHNICAL_DEFINITIONS.map((key) => {
    const name = key.split("/").at(-1);
    return [name, { type: name === "duration" ? "integer" : "string", "x-technical": true }];
  }),
);
technicalDefs.commit.pattern = "^[0-9a-f]{40}$";
const common = {
  $defs: {
    ...technicalDefs,
    shortId: { type: "string" },
    elementId: { anyOf: [{ $ref: "#/$defs/uuid" }, { $ref: "#/$defs/shortId" }] },
    incomplete: { title: "Incomplete", type: "boolean", "x-normal": false },
    problem: {
      type: "object",
      properties: {
        code: { title: "Problem kind", $ref: "#/$defs/problemCode" },
        file: { title: "File", $ref: "#/$defs/outputPath", "x-technical": "with-element" },
        line: { title: "Line", type: "integer", "x-technical": "with-element" },
      },
    },
  },
};
const schemas = { "common.schema.json": common };
const C = "../common.schema.json#/$defs/";
const problems = { title: "Problems", "x-normal": [], type: "array", items: { $ref: `${C}problem` } };

/** A read command with these output properties. */
const read = (properties, extra = {}) => ({
  name: "x.read",
  effect: "read",
  input: { type: "object" },
  output: { type: "object", properties },
  ...extra,
});
const errorsOf = (...commands) => checkOutputs({ commands }, schemas);

describe("checkOutputs", () => {
  it("accepts the repository's catalog", () => {
    const { catalog, schemas: all } = loadContracts();
    expect(checkOutputs(catalog, all)).toEqual([]);
  });

  it("accepts titled and marked fields, also titles and marks of a definition", () => {
    expect(
      errorsOf(
        read({
          problems,
          incomplete: { $ref: `${C}incomplete` },
          view: { title: "View", $ref: `${C}elementId` },
          ids: { title: "Elements", "x-elements": "answer", type: "array", items: { $ref: `${C}uuid` } },
          rows: {
            title: "Rows",
            "x-elements": true,
            type: "array",
            items: { type: "object", properties: { id: { title: "Element", $ref: `${C}uuid` } } },
          },
          count: { title: "Count", type: "integer", "x-elements": ["ids", "rows"] },
        }),
      ),
    ).toEqual([]);
  });

  it("[SR-224/AK-yxs1] refuses a field without a title or with a wrong one, and a technical kind not marked", () => {
    expect(
      errorsOf(
        read({
          bare: { type: "string" },
          long: { title: "A title that is far longer than forty characters", type: "string" },
          dot: { title: "Ends with a dot.", type: "string" },
          ref: { title: "See SR-224", type: "string" },
          commit: { title: "Commit", type: "string", pattern: "^[0-9a-f]{40}$" },
          id: { title: "ID", type: "string", format: "uuid" },
          off: { title: "Off", $ref: `${C}uuid`, "x-technical": false },
          line: { title: "Line", type: "integer", "x-technical": "with-element" },
        }),
      ),
    ).toEqual([
      "schemas/commands/x.read.json#/output/properties/bare (bare): has no title (SR-224 AK3)",
      'schemas/commands/x.read.json#/output/properties/long (long): title "A title that is far longer than forty characters": sentence case, at most 40 characters, no final punctuation, no internal reference',
      'schemas/commands/x.read.json#/output/properties/dot (dot): title "Ends with a dot.": sentence case, at most 40 characters, no final punctuation, no internal reference',
      'schemas/commands/x.read.json#/output/properties/ref (ref): title "See SR-224": sentence case, at most 40 characters, no final punctuation, no internal reference',
      "schemas/commands/x.read.json#/output/properties/commit (commit): repeats the pattern of common.schema.json#/$defs/commit; refer to it",
      "schemas/commands/x.read.json#/output/properties/id (id): is a UUID: refer to common.schema.json#/$defs/uuid",
      'schemas/commands/x.read.json#/output/properties/off (off): x-technical is true or "with-element"; leave it out otherwise',
      'schemas/commands/x.read.json#/output/properties/line (line): x-technical "with-element" is only for file and line of a problem',
    ]);
  });

  it("needs the definitions of SR-224 AK3 marked, and no other definition", () => {
    const { uuid, ...rest } = common.$defs;
    const changed = {
      "common.schema.json": { $defs: { ...rest, uuid: { type: "string" }, other: { "x-technical": true } } },
    };
    expect(checkOutputs({ commands: [] }, changed)).toEqual([
      'common.schema.json#/$defs/uuid: a definition SR-224 AK3 names needs "x-technical": true',
      "common.schema.json#/$defs/other: only the definitions SR-224 AK3 names carry x-technical; mark the field instead",
    ]);
    expect(uuid["x-technical"]).toBe(true);
    const wrong = {
      "common.schema.json": { $defs: { ...common.$defs, uuid: { "x-technical": "with-element" } } },
    };
    expect(checkOutputs({ commands: [] }, wrong)).toEqual([
      "common.schema.json#/$defs/uuid: x-technical of a definition is true",
    ]);
  });

  it("needs the normal value of problems and incomplete", () => {
    expect(
      errorsOf(
        read({
          problems: { title: "Problems", type: "array", items: { $ref: `${C}problem` } },
          incomplete: { title: "Incomplete", type: "boolean" },
        }),
      ),
    ).toEqual([
      'schemas/commands/x.read.json: output problems: "x-normal": [] (no problems is the normal value, SR-223 AK7)',
      "schemas/commands/x.read.json: output incomplete: refers to common.schema.json#/$defs/incomplete, whose normal value is false",
    ]);
  });

  it("checks the elements of lists, of the answer and of counts (SR-224 AK4)", () => {
    const uuids = { type: "array", items: { $ref: `${C}uuid` } };
    expect(
      errorsOf(
        read({
          texts: { title: "Texts", "x-elements": true, type: "array", items: { type: "string" } },
          one: { title: "One", "x-elements": "answer", ...uuids },
          two: { title: "Two", "x-elements": "answer", ...uuids },
          nested: {
            title: "Nested",
            type: "object",
            properties: { ids: { title: "IDs", "x-elements": "answer", ...uuids } },
          },
          text: { title: "Text", type: "string", "x-elements": "one" },
          count: { title: "Count", type: "integer", "x-elements": "texts/none" },
          odd: { title: "Odd", type: "integer", "x-elements": 3 },
        }),
      ),
    ).toEqual([
      'schemas/commands/x.read.json: output texts: x-elements true is for an array of UUIDs or of objects with a UUID "id"',
      'schemas/commands/x.read.json: output nested.ids: x-elements "answer" is for a top-level field',
      "schemas/commands/x.read.json: output text: x-elements with paths is for a number that counts elements",
      'schemas/commands/x.read.json: output count: x-elements "texts/none" names no field with x-elements true or "answer"',
      'schemas/commands/x.read.json: output odd: x-elements is true, "answer", or the paths of the lists a number counts',
      'schemas/commands/x.read.json: x-elements "answer" on one, two, nested.ids: at most one field is the answer',
    ]);
  });

  it("[SR-224/AK-zk0v] holds showsOutput to the write commands with content of their own, in both directions", () => {
    const write = (name, extra = {}) => ({
      ...read({ problems }, extra),
      name,
      effect: "write-files",
    });
    expect([...SHOWS_OUTPUT].sort()).toEqual([
      "element.bulkUpdate",
      "evidence.enrichJunit",
      "reqif.export",
      "reqif.import",
      "tool.guide",
      "workspace.init",
    ]);
    expect(errorsOf(write("reqif.import", { showsOutput: true }), write("element.update"))).toEqual([]);
    expect(
      errorsOf(write("reqif.import"), write("element.update", { showsOutput: true }), {
        ...read({ problems }, { showsOutput: true }),
        name: "reqif.export",
      }),
    ).toEqual([
      "schemas/commands/reqif.import.json: showsOutput: true, since its output carries content of its own (SR-224 AK7)",
      "schemas/commands/element.update.json: showsOutput: only the write commands of SHOWS_OUTPUT in output-checks.mjs show their output (SR-224 AK7)",
      "schemas/commands/reqif.export.json: showsOutput: true, since its output carries content of its own (SR-224 AK7)",
    ]);
  });

  it("keeps marks out of inputs and outputFields out of command files", () => {
    expect(
      errorsOf(
        read(
          { problems },
          {
            input: { type: "object", properties: { a: { "x-technical": true, type: "string" } } },
            outputFields: [],
          },
        ),
      ),
    ).toEqual([
      "schemas/commands/x.read.json: input/properties/a: x-technical: marks are for outputs",
      "schemas/commands/x.read.json: outputFields: written by generate.mjs into the generated catalog only",
    ]);
  });
});

describe("output fields", () => {
  it("walks properties, items, maps and branches, and ends at a definition met again", () => {
    const local = {
      "common.schema.json": {
        $defs: {
          ...common.$defs,
          node: { type: "object", properties: { child: { title: "Child", $ref: "#/$defs/node" } } },
        },
      },
    };
    const output = {
      type: "object",
      properties: {
        tree: { title: "Tree", $ref: `${C}node` },
        map: {
          title: "Map",
          type: "object",
          additionalProperties: { type: "object", properties: { n: { title: "N" } } },
        },
        either: { title: "Either", anyOf: [{ type: "object", properties: { a: { title: "A" } } }] },
        rows: {
          title: "Rows",
          type: "array",
          items: { type: "object", properties: { id: { $ref: `${C}uuid` } } },
        },
        all: {
          title: "All",
          allOf: [{ properties: { b: { title: "B" } } }],
          then: { properties: { c: { title: "C" } } },
        },
      },
    };
    expect(outputFieldsOf(output, local).map((f) => f.path)).toEqual([
      "tree",
      "tree.child",
      "map",
      "map.*.n",
      "either",
      "either.a",
      "rows",
      "rows[].id",
      "all",
      "all.b",
      "all.c",
    ]);
    expect(resolvedOutputFields(output, local).find((f) => f.path === "rows[].id")).toEqual({
      path: "rows[].id",
      technical: true,
    });
  });

  it("resolves titles, technical values, normal values and the paths of counted lists", () => {
    const { catalog, schemas: all } = loadContracts();
    const coverage = catalog.commands.find((cmd) => cmd.name === "evidence.coverage");
    const fields = resolvedOutputFields(coverage.output, all);
    expect(fields.find((f) => f.path === "levels[].total")).toEqual({
      path: "levels[].total",
      title: "Total",
      elements: ["levels[].elements.withChildren", "levels[].elements.withoutChildren"],
    });
    expect(fields.find((f) => f.path === "levels[].elements.withChildren")).toMatchObject({
      technical: true,
      elements: true,
    });
    expect(fields.find((f) => f.path === "incomplete")).toEqual({
      path: "incomplete",
      title: "Incomplete",
      normal: false,
    });
    // A branch of `anyOf` that is technical makes the field technical (`viewId` → `elementId` → `uuid`).
    expect(technicalOf({ $ref: "#/$defs/viewId" }, "common.schema.json", all)).toBe(true);
    expect(technicalOf({ type: "string" }, "common.schema.json", all)).toBe(false);
  });
});
