import { describe, expect, it } from "vitest";
import { loadContracts } from "./load.mjs";
import { checkCatalog, SUMMARY_WORDS } from "./catalog-checks.mjs";

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
      'schemas/commands/test.two.json: title "Same" is also the title of test.one',
    ]);
    expect(check(command("test.one", "Remove it"))).toEqual([
      'schemas/commands/test.one.json: title "Remove it": elements are superseded, never deleted (D-045)',
    ]);
    expect(check(command("relation.one", "Remove relation"))).toEqual([]);
  });

  it("a summary has at most 50 words, counted at white space (#1252)", () => {
    const words = (n) => Array.from({ length: n }, (_, i) => `w${String(i)}`).join(" ");
    expect(check({ ...command("test.one", "One"), summary: words(SUMMARY_WORDS) })).toEqual([]);
    expect(check({ ...command("test.one", "One"), summary: `${words(SUMMARY_WORDS)} (SR-001)` })).toEqual([
      "schemas/commands/test.one.json: summary has 51 words, more than 50: keep one or two sentences, move the rest to details",
    ]);
  });

  it("a flag of its own clashes neither with another field's flag nor with a common option (ADR-0009)", () => {
    const flagged = (flag) => ALL.map((a) => (a.field === "limit" ? { ...a, flag } : a));
    expect(check(command("test.one", "One", flagged("max")))).toEqual([]);
    expect(check(command("test.one", "One", flagged("json")))).toEqual([
      'schemas/commands/test.one.json: arguments: "limit": flag "json" is a common option',
    ]);
    expect(check(command("test.one", "One", flagged("deep")))).toEqual([
      'schemas/commands/test.one.json: arguments: "limit": flag "deep" is also the flag of another field',
    ]);
    // `deep` is a boolean, so `--no-deep` is taken too.
    expect(check(command("test.one", "One", flagged("no-deep")))).toEqual([
      'schemas/commands/test.one.json: arguments: "limit": flag "no-deep" is also the flag of another field',
    ]);
    expect(check(command("test.one", "One", flagged("no-kind")))).toEqual([]);
  });

  it("a part flag of a selection, condition or sort clashes with no other flag (#149)", () => {
    const withParts = (properties, extra) =>
      command("test.one", "One", [...ALL, ...extra], {
        ...input,
        properties: { ...input.properties, ...properties },
      });
    const selection = { $ref: "../common.schema.json#/$defs/selection" };
    const sort = { type: "array", items: { $ref: "../filter.schema.json#/$defs/sortKey" } };
    expect(
      check(withParts({ selection, sort }, [arg("selection", "selection"), arg("sort", "json")])),
    ).toEqual([]);
    expect(
      check(
        withParts({ selection, ids: { type: "string" } }, [
          arg("selection", "selection"),
          arg("ids", "json"),
        ]),
      ),
    ).toEqual([
      'schemas/commands/test.one.json: arguments: "selection": part flag "ids" is also the flag of another field',
    ]);
    const condition = { $ref: "../filter.schema.json#/$defs/condition" };
    expect(
      check(
        withParts({ selection, where: condition }, [arg("selection", "selection"), arg("where", "json")]),
      ),
    ).toHaveLength(6);
    expect(check(withParts({ json: sort }, [arg("json", "json")]))).toEqual([
      'schemas/commands/test.one.json: arguments: "json": part flag "json" is a common option',
    ]);
  });

  it("lists every input field exactly once", () => {
    expect(check(command("test.one", "One", ALL.slice(1)))).toEqual([
      'schemas/commands/test.one.json: arguments: input field "ref" must be listed exactly once in arguments (found 0)',
      'schemas/commands/test.one.json: arguments: "kind": "of" must name an earlier element or relationTarget field, not "ref"',
    ]);
    expect(check(command("test.one", "One", [...ALL, arg("limit", "number")]))).toEqual([
      'schemas/commands/test.one.json: arguments: input field "limit" must be listed exactly once in arguments (found 2)',
    ]);
    expect(check(command("test.one", "One", [...ALL, arg("other", "text")]))).toEqual([
      'schemas/commands/test.one.json: arguments: "other" is no input field',
    ]);
  });

  it("asks the required fields first", () => {
    const args = [ALL[2], ALL[0], ALL[1], ALL[3], ALL[4], ALL[5]];
    expect(check(command("test.one", "One", args))).toEqual([
      'schemas/commands/test.one.json: arguments: required "ref" comes after optional "limit"',
    ]);
  });

  it("`of` names an earlier field of a fitting source and only a source that reads one", () => {
    const later = [ALL[0], arg("kind", "relationKind", "limit"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", later))).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": "of" must name an earlier element or relationTarget field, not "limit"',
    ]);
    // relation reads the elements of a source, or the kind of a relation asked before.
    const relation = [ALL[0], arg("kind", "relation", "ref"), arg("limit", "number"), ...ALL.slice(3)];
    expect(check(command("test.one", "One", relation))).toEqual([]);
    const text = [ALL[0], arg("kind", "text", "ref"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", text))).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": text takes no "of"',
    ]);
  });

  it("replaces names earlier optional fields only, each once", () => {
    const at = (replaces) => ALL.map((a) => (a.field === "deep" ? { ...a, replaces } : a));
    expect(check(command("test.one", "One", at(["kind", "limit"])))).toEqual([]);
    expect(check(command("test.one", "One", at(["ref", "direction", "limit", "limit"])))).toEqual([
      'schemas/commands/test.one.json: arguments: "deep": "replaces" must name earlier optional fields, each once, not "ref"',
      'schemas/commands/test.one.json: arguments: "deep": "replaces" must name earlier optional fields, each once, not "direction"',
      'schemas/commands/test.one.json: arguments: "deep": "replaces" must name earlier optional fields, each once, not "limit"',
    ]);
  });

  it("a source that reads a field needs a fitting one before it, unless it can give every value", () => {
    const first = { ...input, required: ["kind"] };
    const args = [arg("kind", "value"), ...ALL.filter((a) => a.field !== "kind")];
    expect(check(command("test.one", "One", args, first))).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": value needs an earlier property field',
    ]);
    // An earlier field of another source does not count.
    const target = [ALL[0], arg("kind", "relationTarget"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", target))).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": relationTarget needs an earlier relationKind field',
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
      'schemas/commands/test.one.json: arguments: "limit": boolean needs a boolean field',
      'schemas/commands/test.one.json: arguments: "deep": number needs an integer field',
      'schemas/commands/test.one.json: arguments: "direction": boolean needs a boolean field',
      'schemas/commands/test.one.json: arguments: "meanings": number needs an integer field',
    ]);
    const local = { $ref: "../common.schema.json#/$defs/localPath" };
    const paths = {
      ...input,
      properties: { ...input.properties, file: local, files: { type: "array", items: local } },
    };
    expect(
      check(command("test.one", "One", [...ALL, arg("file", "file"), arg("files", "folder")], paths)),
    ).toEqual([]);
    expect(
      check(command("test.one", "One", [...ALL, arg("file", "text"), arg("files", "file")], paths)),
    ).toEqual([
      'schemas/commands/test.one.json: arguments: "file": a localPath field is completed as folder or file',
    ]);
    const onText = [ALL[0], arg("kind", "folder"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", onText))).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": folder needs a localPath field',
    ]);
    const choice = [ALL[0], arg("kind", "choice"), ...ALL.slice(2)];
    expect(check(command("test.one", "One", choice))).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": choice needs an inline enum',
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
    // Another array is a value every line carries (data.export: `repositories`, SR-062 AK1).
    expect(lines({ items: "rows", fields: ["names"] })).toEqual([]);
  });

  it("refuses items that are no top-level array", () => {
    expect(lines({ items: "version", fields: [] })).toEqual([
      'schemas/commands/test.one.json: jsonLines: "version" is not a top-level array of the output',
    ]);
    expect(lines({ items: "missing", fields: [] })).toEqual([
      'schemas/commands/test.one.json: jsonLines: "missing" is not a top-level array of the output',
    ]);
  });

  it("refuses fields that are missing, the array of the lines, or also keys of an item", () => {
    expect(lines({ items: "rows", fields: ["missing", "rows", "version"] })).toEqual([
      'schemas/commands/test.one.json: jsonLines: "missing" is not a top-level field of the output',
      'schemas/commands/test.one.json: jsonLines: "rows" is the array of the lines',
      'schemas/commands/test.one.json: jsonLines: "version" is also a property of the items of "rows"',
    ]);
  });
});
