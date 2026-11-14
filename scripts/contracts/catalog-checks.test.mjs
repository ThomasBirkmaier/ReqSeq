import { describe, expect, it } from "vitest";
import { loadContracts } from "./load.mjs";
import { checkCatalog, contextOf, SUMMARY_WORDS } from "./catalog-checks.mjs";

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
/** An entry of `arguments`; a `text` source gets the class every one needs (SR-215 AK2). */
const arg = (field, complete, of) => ({
  field,
  complete,
  ...(of ? { of } : {}),
  ...(complete === "text" ? { class: "name" } : {}),
});
const ALL = [
  arg("ref", "element"),
  arg("kind", "relationKind", "ref"),
  arg("limit", "number"),
  arg("deep", "boolean"),
  arg("direction", "choice"),
  arg("meanings", "choice"),
];
/** `schema` with a description on each property that has none, which every argument needs (SR-210 AK6). */
const described = (schema) =>
  schema.properties === undefined
    ? schema
    : {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([field, property]) => [
            field,
            { description: `The ${field}.`, ...property },
          ]),
        ),
      };
const command = (name, title, args = ALL, schema = input) => ({
  name,
  title,
  arguments: args,
  input: described(schema),
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
      check(withParts({ selection, sort }, [arg("selection", "selection"), arg("sort", "sort")])),
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
        withParts({ selection, where: condition }, [
          arg("selection", "selection"),
          arg("where", "condition"),
        ]),
      ),
    ).toHaveLength(6);
    expect(check(withParts({ json: sort }, [arg("json", "sort")]))).toEqual([
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
      'schemas/commands/test.one.json: arguments: "kind": choice needs an enum, inline or as the definition its $ref names',
    ]);
    // An enum the field names by a `$ref` counts (#1575), one that leads to no enum does not.
    const schemas = {
      "common.schema.json": { $defs: { code: { enum: ["a.b"] }, uuid: { type: "string" } } },
    };
    const referred = (ref) => ({
      ...input,
      properties: { ...input.properties, kind: { type: "array", items: { $ref: ref } } },
    });
    const checkWith = (ref) =>
      checkCatalog({ commands: [command("test.one", "One", choice, referred(ref))] }, schemas);
    expect(checkWith("../common.schema.json#/$defs/code")).toEqual([]);
    expect(checkWith("../common.schema.json#/$defs/uuid")).toEqual([
      'schemas/commands/test.one.json: arguments: "kind": choice needs an enum, inline or as the definition its $ref names',
    ]);
  });

  it("every argument has a description, its own or the one of the type its $ref names (SR-210 AK6)", () => {
    const schemas = {
      "common.schema.json": {
        $defs: { named: { type: "string", description: "A named type." }, bare: { type: "string" } },
      },
    };
    const raw = (properties) => ({
      name: "test.one",
      title: "One",
      arguments: Object.keys(properties).map((field) => arg(field, "text")),
      input: { type: "object", properties },
    });
    const named = { $ref: "../common.schema.json#/$defs/named" };
    const bare = { $ref: "../common.schema.json#/$defs/bare" };
    const own = { type: "string", description: "Own." };
    const list = (items) => ({ type: "array", items });
    expect(checkCatalog({ commands: [raw({ own, named, names: list(named) })] }, schemas)).toEqual([]);
    const missing = (field) =>
      `schemas/commands/test.one.json: arguments: "${field}": needs a description, its own or one of the type its $ref names`;
    expect(
      checkCatalog(
        {
          commands: [
            raw({
              none: { type: "string" },
              blank: { type: "string", description: " " },
              bare,
              bares: list(bare),
              nowhere: { $ref: "../nowhere.schema.json#/$defs/x" },
            }),
          ],
        },
        schemas,
      ),
    ).toEqual([
      missing("none"),
      'schemas/commands/test.one.json: arguments: "blank": has a blank description',
      ...["bare", "bares", "nowhere"].map(missing),
    ]);
    // A blank own description is refused even where the type has one: it would be shown.
    const blankNamed = { ...named, description: "" };
    expect(checkCatalog({ commands: [raw({ blankNamed })] }, schemas)).toEqual([
      'schemas/commands/test.one.json: arguments: "blankNamed": has a blank description',
    ]);
  });

  it("binds condition, sort, group and searchField to their schemas both ways, the others one way (SR-215)", () => {
    const at = (field, complete, of) => ({ ...arg(field, complete), ...(of === undefined ? {} : { of }) });
    const fields = {
      ref: { type: "string" },
      type: { type: "string" },
      where: { $ref: "../filter.schema.json#/$defs/condition" },
      sort: { type: "array", items: { $ref: "../filter.schema.json#/$defs/sortKey" } },
      group: { $ref: "../common.schema.json#/$defs/groupKey" },
      fields: { type: "array", items: { $ref: "../common.schema.json#/$defs/searchFieldKey" } },
      properties: {
        type: "object",
        additionalProperties: { $ref: "../element.schema.json#/$defs/inputValue" },
      },
      relations: { $ref: "../common.schema.json#/$defs/relationRefs" },
      path: { $ref: "../common.schema.json#/$defs/localPath" },
      metamodel: { type: "object", properties: { repository: { type: "string" }, path: { type: "string" } } },
      folder: { type: "string" },
      criteria: { type: "array", items: { type: "string" } },
      file: { type: "string" },
    };
    const right = [
      at("ref", "element"),
      at("type", "type"),
      at("where", "condition"),
      at("sort", "sort"),
      at("group", "group"),
      at("fields", "searchField"),
      at("properties", "properties"),
      at("relations", "relations"),
      at("path", "folder"),
      at("metamodel", "metamodelLocation"),
      at("folder", "evidenceLocation"),
      at("criteria", "criterion"),
      at("file", "elementFile"),
    ];
    const schema = { type: "object", properties: fields, required: ["ref"] };
    const with_ = (args) => check(command("test.one", "One", args, schema));
    const swap = (field, complete) => right.map((a) => (a.field === field ? at(field, complete) : a));
    expect(with_(right)).toEqual([]);
    const error = (text) => `schemas/commands/test.one.json: arguments: ${text}`;
    // Both ways: such a field only so, and the source only on such a field.
    expect(with_(swap("where", "json"))).toEqual([
      error('"where": a condition field is completed as condition'),
    ]);
    expect(with_(swap("sort", "json"))).toEqual([
      error('"sort": a list of sortKey field is completed as sort'),
    ]);
    expect(with_(swap("group", "text"))).toEqual([error('"group": a groupKey field is completed as group')]);
    expect(with_(swap("file", "condition"))).toEqual([error('"file": condition needs a condition field')]);
    expect(with_(swap("file", "sort"))).toEqual([error('"file": sort needs a list of sortKey field')]);
    expect(with_(swap("file", "group"))).toEqual([error('"file": group needs a groupKey field')]);
    expect(with_(swap("fields", "json"))).toEqual([
      error('"fields": a list of searchFieldKey field is completed as searchField'),
    ]);
    expect(with_(swap("file", "searchField"))).toEqual([
      error('"file": searchField needs a list of searchFieldKey field'),
    ]);
    // One way: such a field may stay json (element.update), the source needs it.
    expect(with_(swap("properties", "json"))).toEqual([]);
    expect(with_(swap("relations", "json"))).toEqual([]);
    expect(with_(swap("metamodel", "json"))).toEqual([]);
    expect(with_(swap("relations", "properties"))).toEqual([
      error('"relations": properties needs an object of inputValue field'),
    ]);
    expect(with_(swap("properties", "relations"))).toEqual([
      error('"properties": relations needs a relationRefs field'),
    ]);
    expect(with_(swap("folder", "metamodelLocation"))).toEqual([
      error('"folder": metamodelLocation needs an object with repository and path field'),
    ]);
    expect(with_(swap("metamodel", "evidenceLocation"))).toEqual([
      error('"metamodel": evidenceLocation needs a string field'),
    ]);
    // The sources that read a field need it before them.
    const early = [
      at("ref", "element"),
      at("properties", "properties"),
      ...right.filter((a) => a.field !== "ref" && a.field !== "properties"),
    ];
    expect(with_(early)).toEqual([error('"properties": properties needs an earlier type field')]);
    const first = { ...schema, required: ["criteria"] };
    const criteriaFirst = [at("criteria", "criterion"), ...right.filter((a) => a.field !== "criteria")];
    expect(check(command("test.one", "One", criteriaFirst, first))).toEqual([
      error('"criteria": criterion needs an earlier element field'),
    ]);
    const noFolder = right.map((a) => (a.field === "path" ? at("path", "text") : a));
    expect(with_(noFolder)).toEqual([
      error('"path": a localPath field is completed as folder or file'),
      error('"metamodel": metamodelLocation needs an earlier folder field'),
    ]);
  });

  it("a meaning only on an element source, and never the field a source without `of` reads (SR-215)", () => {
    const fields = {
      ref: { type: "string" },
      variant: { type: "string" },
      criteria: { type: "string" },
      file: { type: "string" },
    };
    const schema = { type: "object", properties: fields, required: ["ref"] };
    const variant = { field: "variant", complete: "element", meaning: "variant" };
    const args = [arg("ref", "element"), variant, arg("criteria", "criterion"), arg("file", "elementFile")];
    expect(check(command("test.one", "One", args, schema))).toEqual([]);
    // `criteria` reads `ref`, not the nearer `variant`.
    expect(contextOf(args, 2)).toBe("ref");
    expect(contextOf(args, 3)).toBe("ref");
    expect(contextOf(args, 1)).toBeUndefined();
    expect(contextOf(args, 9)).toBeUndefined();
    // Without another element field before it, nothing fits; an explicit `of` may name it.
    const only = [variant, arg("ref", "element"), arg("criteria", "criterion"), arg("file", "elementFile")];
    const variantFirst = { ...schema, required: ["variant"] };
    expect(contextOf([variant, arg("criteria", "criterion")], 1)).toBeUndefined();
    expect(
      check(
        command(
          "test.one",
          "One",
          [variant, arg("criteria", "criterion"), arg("ref", "element"), arg("file", "elementFile")],
          variantFirst,
        ),
      ),
    ).toEqual([
      'schemas/commands/test.one.json: arguments: "criteria": criterion needs an earlier element field',
    ]);
    expect(check(command("test.one", "One", only, variantFirst))).toEqual([]);
    expect(contextOf([variant, arg("criteria", "criterion", "variant")], 1)).toBe("variant");
    const onText = [
      arg("ref", "element"),
      { ...arg("variant", "text"), meaning: "variant" },
      ...args.slice(2),
    ];
    expect(check(command("test.one", "One", onText, schema))).toEqual([
      'schemas/commands/test.one.json: arguments: "variant": meaning is only for an element source, not text',
    ]);
  });

  it("a class on every text source and only there (SR-215 AK2)", () => {
    const fields = { ref: { type: "string" }, name: { type: "string" }, limit: { type: "integer" } };
    const schema = { type: "object", properties: fields, required: ["ref"] };
    const classed = [arg("ref", "element"), arg("name", "text"), arg("limit", "number")];
    expect(check(command("test.one", "One", classed, schema))).toEqual([]);
    const unclassed = [arg("ref", "element"), { field: "name", complete: "text" }, arg("limit", "number")];
    expect(check(command("test.one", "One", unclassed, schema))).toEqual([
      'schemas/commands/test.one.json: arguments: "name": a text source needs a class (SR-215 AK2)',
    ]);
    const onNumber = [
      arg("ref", "element"),
      arg("name", "text"),
      { ...arg("limit", "number"), class: "name" },
    ];
    expect(check(command("test.one", "One", onNumber, schema))).toEqual([
      'schemas/commands/test.one.json: arguments: "limit": class is only for a text source, not number',
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

describe("catalog checks (textOutput, SR-151 AK4)", () => {
  const output = {
    type: "object",
    properties: { text: { type: "string" }, loose: { type: "string" }, count: { type: "integer" } },
    required: ["text", "count"],
  };
  const text = (textOutput) =>
    checkCatalog({
      commands: [{ ...command("test.one", "One", [], { type: "object" }), output, textOutput }],
    });

  it("accepts a required top-level string and refuses any other field", () => {
    expect(text("text")).toEqual([]);
    expect(["loose", "count", "missing"].flatMap(text)).toEqual(
      ["loose", "count", "missing"].map(
        (field) =>
          `schemas/commands/test.one.json: textOutput: "${field}" is not a required top-level string of the output`,
      ),
    );
  });
});
