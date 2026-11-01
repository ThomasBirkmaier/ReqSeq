import { describe, expect, it } from "vitest";
import { loadContracts } from "./load.mjs";
import { checkCatalog } from "./catalog-checks.mjs";

const input = {
  type: "object",
  properties: {
    ref: { type: "string" },
    kind: { type: "string" },
    limit: { type: "integer" },
    deep: { type: "boolean" },
    direction: { enum: ["up", "down"] },
    meanings: { type: "array", items: { enum: ["a", "b"] } },
  },
  required: ["ref"],
};
const arg = (field, complete, of) => (of ? { field, complete, of } : { field, complete });
const ALL = [
  arg("ref", "element"),
  arg("kind", "relationKind", "ref"),
  arg("limit", "number"),
  arg("deep", "boolean"),
  arg("direction", "choice"),
  arg("meanings", "choice"),
];
const command = (name, title, args = ALL, schema = input) => ({
  name,
  title,
  arguments: args,
  input: schema,
});
const check = (...commands) => checkCatalog({ commands });

describe("catalog checks (titles and argument sources, SR-108)", () => {
  it("accepts the product catalog", () => {
    const { catalog, schemas } = loadContracts();
    expect(checkCatalog(catalog, schemas)).toEqual([]);
  });

  it("accepts a complete argument list", () => {
    expect(check(command("test.one", "One"))).toEqual([]);
  });

  it("every title is unique and delete words are only for relations (D-045)", () => {
    expect(check(command("test.one", "Same"), command("test.two", "Same"))).toEqual([
      'catalog.json: test.two: title "Same" is also the title of test.one',
    ]);
    expect(check(command("test.one", "Remove it"))).toEqual([
      'catalog.json: test.one: title "Remove it": elements are superseded, never deleted (D-045)',
    ]);
    expect(check(command("relation.one", "Remove relation"))).toEqual([]);
  });

  it("a flag of its own clashes neither with another field's flag nor with a common option (ADR-0009)", () => {
    const flagged = (flag) => ALL.map((a) => (a.field === "limit" ? { ...a, flag } : a));
    expect(check(command("test.one", "One", flagged("max")))).toEqual([]);
    expect(check(command("test.one", "One", flagged("json")))).toEqual([
      'catalog.json: test.one: arguments: "limit": flag "json" is a common option',
    ]);
    expect(check(command("test.one", "One", flagged("deep")))).toEqual([
      'catalog.json: test.one: arguments: "limit": flag "deep" is also the flag of another field',
    ]);
  });

  it("lists every input field exactly once", () => {
    expect(check(command("test.one", "One", ALL.slice(1)))).toEqual([
      'catalog.json: test.one: arguments: input field "ref" must be listed exactly once in arguments (found 0)',
      'catalog.json: test.one: arguments: "kind": "of" must name an earlier element or relationTarget field, not "ref"',
    ]);
    expect(check(command("test.one", "One", [...ALL, arg("limit", "number")]))).toEqual([
      'catalog.json: test.one: arguments: input field "limit" must be listed exactly once in arguments (found 2)',
    ]);
    expect(check(command("test.one", "One", [...ALL, arg("other", "text")]))).toEqual([
      'catalog.json: test.one: arguments: "other" is no input field',
    ]);
  });

  it("asks the required fields first", () => {
    const args = [ALL[2], ALL[0], ALL[1], ALL[3], ALL[4], ALL[5]];
    expect(check(command("test.one", "One", args))).toEqual([
      'catalog.json: test.one: arguments: required "ref" comes after optional "limit"',
    ]);
  });

  it("`of` names an earlier field of a fitting source and only a source that reads one", () => {
    const later = [ALL[0], arg("kind", "relationKind", "limit"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", later))).toEqual([
      'catalog.json: test.one: arguments: "kind": "of" must name an earlier element or relationTarget field, not "limit"',
    ]);
    // relation reads the elements of a source, or the kind of a relation asked before.
    const relation = [ALL[0], arg("kind", "relation", "ref"), arg("limit", "number"), ...ALL.slice(3)];
    expect(check(command("test.one", "One", relation))).toEqual([]);
    const text = [ALL[0], arg("kind", "text", "ref"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", text))).toEqual([
      'catalog.json: test.one: arguments: "kind": text takes no "of"',
    ]);
  });

  it("a source that reads a field needs a fitting one before it, unless it can give every value", () => {
    const first = { ...input, required: ["kind"] };
    const args = [arg("kind", "value"), ...ALL.filter((a) => a.field !== "kind")];
    expect(check(command("test.one", "One", args, first))).toEqual([
      'catalog.json: test.one: arguments: "kind": value needs an earlier property field',
    ]);
    // An earlier field of another source does not count.
    const target = [ALL[0], arg("kind", "relationTarget"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", target))).toEqual([
      'catalog.json: test.one: arguments: "kind": relationTarget needs an earlier relationKind field',
    ]);
    // Every relation kind of the metamodel when no element comes before.
    const kinds = [arg("kind", "relationKind"), ...ALL.filter((a) => a.field !== "kind")];
    expect(check(command("test.one", "One", kinds, first))).toEqual([]);
  });

  it("typed sources fit their field", () => {
    const wrong = [
      ALL[0],
      ALL[1],
      arg("limit", "boolean"),
      arg("deep", "number"),
      arg("direction", "boolean"),
      arg("meanings", "number"),
    ];
    expect(check(command("test.one", "One", wrong))).toEqual([
      'catalog.json: test.one: arguments: "limit": boolean needs a boolean field',
      'catalog.json: test.one: arguments: "deep": number needs an integer field',
      'catalog.json: test.one: arguments: "direction": boolean needs a boolean field',
      'catalog.json: test.one: arguments: "meanings": number needs an integer field',
    ]);
    const choice = [ALL[0], arg("kind", "choice"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", choice))).toEqual([
      'catalog.json: test.one: arguments: "kind": choice needs an inline enum',
    ]);
  });

  it("an input without properties has no arguments", () => {
    expect(check(command("test.one", "One", [], { type: "object" }))).toEqual([]);
  });
});

describe("catalog checks (jsonLines, #319)", () => {
  const schemas = {
    "lines.schema.json": {
      type: "object",
      properties: {
        version: { const: 1 },
        names: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { $ref: "#/$defs/row" } },
      },
      $defs: {
        row: { allOf: [{ $ref: "#/$defs/fields" }], unevaluatedProperties: false },
        fields: { type: "object", properties: { id: { type: "string" }, version: { type: "integer" } } },
      },
    },
  };
  const withLines = (jsonLines, output = { type: "object", $ref: "../lines.schema.json" }) => ({
    ...command("test.one", "One", [], { type: "object" }),
    output,
    jsonLines,
  });
  const lines = (jsonLines, output) => checkCatalog({ commands: [withLines(jsonLines, output)] }, schemas);

  it("accepts items that are a top-level array and fields that are top-level values", () => {
    const inline = {
      type: "object",
      properties: { mark: { const: 1 }, rows: { type: "array", items: { type: "object" } } },
    };
    expect(lines({ items: "rows", fields: [] })).toEqual([]);
    expect(lines({ items: "rows", fields: ["mark"] }, inline)).toEqual([]);
  });

  it("refuses items that are no top-level array", () => {
    expect(lines({ items: "version", fields: [] })).toEqual([
      'catalog.json: test.one: jsonLines: "version" is not a top-level array of the output',
    ]);
    expect(lines({ items: "missing", fields: [] })).toEqual([
      'catalog.json: test.one: jsonLines: "missing" is not a top-level array of the output',
    ]);
  });

  it("refuses fields that are missing, arrays, or also keys of an item", () => {
    expect(lines({ items: "rows", fields: ["missing", "names", "version"] })).toEqual([
      'catalog.json: test.one: jsonLines: "missing" is not a top-level field of the output',
      'catalog.json: test.one: jsonLines: "names" is an array',
      'catalog.json: test.one: jsonLines: "version" is also a property of the items of "rows"',
    ]);
  });
});
