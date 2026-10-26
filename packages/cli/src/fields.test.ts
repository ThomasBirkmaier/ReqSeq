import type { CatalogEntry, JsonSchema } from "@logreq/core";
import { contractsBundle, getCommandRuntime } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { InputField } from "./fields.js";
import { RESERVED_FLAGS, inputFields, kebab } from "./fields.js";

const entry = (input: JsonSchema, name = "test.fields"): CatalogEntry => ({
  name,
  summary: "Fields for the classifier (test only).",
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
  input,
  output: { type: "object" },
});

// Extra schemas for references that loop or use escaped pointers.
const loop: JsonSchema = {
  $id: "https://logreq.dev/schemas/loop.schema.json",
  $defs: {
    a: { $ref: "#/$defs/b" },
    b: { $ref: "#/$defs/a" },
    deep: { anyOf: [{ $ref: "#/$defs/deep" }] },
    "with/slash~tilde": { type: "integer" },
  },
};
const schemas = [...contractsBundle.schemas, loop];

const fieldsOf = (properties: Record<string, unknown>, required: string[] = []): Record<string, InputField> =>
  Object.fromEntries(
    inputFields(entry({ type: "object", properties, required }), schemas).map((f) => [f.name, f]),
  );

const shape = (f: InputField | undefined): string =>
  f === undefined ? "missing" : `${f.kind}${f.array ? "[]" : ""}:${f.use}`;

describe("kebab", () => {
  it("turns camelCase into kebab-case", () => {
    expect(kebab("setStatus")).toBe("set-status");
    expect(kebab("changedFiles")).toBe("changed-files");
    expect(kebab("ref")).toBe("ref");
  });
});

describe("inputFields", () => {
  it("classifies scalar types", () => {
    const f = fieldsOf({
      s: { type: "string" },
      i: { type: "integer" },
      n: { type: "number" },
      b: { type: "boolean" },
      o: { type: "object" },
      nullable: { type: ["string", "null"] },
      untyped: {},
      notASchema: true,
    });
    expect(Object.values(f).map(shape)).toEqual([
      "string:flag",
      "number:flag",
      "number:flag",
      "boolean:flag",
      "complex:input-only",
      "string:flag",
      "complex:input-only",
      "complex:input-only",
    ]);
  });

  it("keeps the form of a scalar that may also be null; null itself goes via --input (#343)", () => {
    const f = fieldsOf(
      {
        typeList: { type: ["string", "null"] },
        anyNull: { anyOf: [{ $ref: "../common.schema.json#/$defs/keyOrName" }, { type: "null" }] },
        oneNull: { oneOf: [{ type: "integer" }, { const: null }] },
        enumNull: { enum: ["a", "b", null] },
        onlyNull: { type: "null" },
        constNull: { const: null },
        anyOnlyNull: { anyOf: [{ type: "null" }, { const: null }] },
        objectOrNull: { type: ["object", "null"] },
        nullItems: { type: "array", items: { type: "null" } },
        nullableItems: { type: "array", items: { type: ["string", "null"] } },
        plain: { type: "string" },
      },
      ["anyNull"],
    );
    expect(Object.values(f).map((field) => `${shape(field)}${field.nullable ? "?" : ""}`)).toEqual([
      "string:flag?",
      "string:positional?",
      "number:flag?",
      "string:flag?",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "string[]:flag",
      "string:flag",
    ]);
    expect(f["enumNull"]?.choices).toEqual(["a", "b"]);
  });

  it("classifies const, enum, anyOf, oneOf and allOf", () => {
    const f = fieldsOf({
      constString: { const: "core" },
      constObject: { const: { a: 1 } },
      enumStrings: { enum: ["a", "b"] },
      enumNumbers: { enum: [1, 2] },
      enumMixed: { enum: ["a", 1] },
      enumEmpty: { enum: [] },
      anyStrings: { anyOf: [{ type: "string" }, { const: "x" }] },
      anyMixed: { anyOf: [{ type: "string" }, { type: "integer" }] },
      anyUntyped: { anyOf: [{}] },
      anyComplexFirst: { anyOf: [{ type: "object" }, { type: "object" }] },
      anyNotSchema: { anyOf: [true] },
      oneBooleans: { oneOf: [{ type: "boolean" }, { const: true }] },
      allNarrowed: { allOf: [{ type: "string" }, { not: { enum: ["id"] } }] },
      allTyped: { type: "integer", allOf: [{ minimum: 1 }] },
      allUntyped: { allOf: [{ not: { const: 1 } }] },
    });
    expect(Object.values(f).map(shape)).toEqual([
      "string:flag",
      "complex:input-only",
      "string:flag",
      "number:flag",
      "complex:input-only",
      "complex:input-only",
      "string:flag",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "boolean:flag",
      "string:flag",
      "number:flag",
      "complex:input-only",
    ]);
    expect(f["enumStrings"]?.choices).toEqual(["a", "b"]);
    expect(f["enumNumbers"]?.choices).toBeUndefined();
    expect(f["constString"]?.choices).toBeUndefined();
  });

  it("follows $refs into the schemas of this version", () => {
    const f = fieldsOf({
      ref: { $ref: "../common.schema.json#/$defs/elementRef" },
      view: { $ref: "../common.schema.json#/$defs/view" },
      status: { $ref: "../common.schema.json#/$defs/verificationStatus" },
      selection: { $ref: "../common.schema.json#/$defs/selection" },
      escaped: { $ref: "../loop.schema.json#/$defs/with~1slash~0tilde" },
      unknownSchema: { $ref: "../nothing.schema.json#/$defs/x" },
      missingPath: { $ref: "../common.schema.json#/$defs/missing/deeper" },
      notASchemaTarget: { $ref: "../common.schema.json#/$defs/uuid/pattern" },
      circular: { $ref: "../loop.schema.json#/$defs/a" },
      deep: { $ref: "../loop.schema.json#/$defs/deep" },
    });
    expect(Object.values(f).map(shape)).toEqual([
      "string:flag",
      "string:flag",
      "string:flag",
      "complex:input-only",
      "number:flag",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
    ]);
    expect(f["status"]?.choices).toEqual(["open", "verified", "indirect", "failed", "outdated"]);
  });

  it("marks local paths, also behind further references and in arrays", () => {
    const local: JsonSchema = {
      $id: "https://logreq.dev/schemas/local.schema.json",
      $defs: { alias: { $ref: "common.schema.json#/$defs/localPath" } },
    };
    const f = Object.fromEntries(
      inputFields(
        entry({
          type: "object",
          properties: {
            file: { $ref: "../common.schema.json#/$defs/localPath" },
            alias: { $ref: "../local.schema.json#/$defs/alias" },
            files: { type: "array", items: { $ref: "../common.schema.json#/$defs/localPath" } },
            ref: { $ref: "../common.schema.json#/$defs/elementRef" },
            names: { type: "array", items: { type: "string" } },
            plain: { type: "string" },
            circular: { $ref: "../loop.schema.json#/$defs/a" },
          },
        }),
        [...schemas, local],
      ).map((field) => [field.name, field.localPath]),
    );
    expect(f).toEqual({
      file: true,
      alias: true,
      files: true,
      ref: false,
      names: false,
      plain: false,
      circular: false,
    });
    const init = getCommandRuntime().contracts.entry("workspace.init");
    expect(init === undefined ? [] : inputFields(init).filter((field) => field.localPath)).toEqual([
      expect.objectContaining({ name: "path", use: "positional", kind: "string" }),
    ]);
  });

  it("takes arrays of scalars as repeatable flags, other arrays only via --input", () => {
    const f = fieldsOf({
      strings: { type: "array", items: { type: "string" } },
      refs: { type: "array", items: { $ref: "../common.schema.json#/$defs/elementRef" } },
      numbers: { type: "array", items: { type: "integer" } },
      viaRef: { $ref: "../common.schema.json#/$defs/selection/properties/ids" },
      objects: { type: "array", items: { type: "object" } },
      untypedItems: { type: "array", items: {} },
      noItems: { type: "array" },
    });
    expect(Object.values(f).map(shape)).toEqual([
      "string[]:flag",
      "string[]:flag",
      "number[]:flag",
      "string[]:flag",
      "complex:input-only",
      "complex:input-only",
      "complex:input-only",
    ]);
  });

  it("makes required string fields positional, in property order", () => {
    const f = fieldsOf(
      {
        target: { type: "string" },
        count: { type: "integer" },
        source: { $ref: "../common.schema.json#/$defs/elementRef" },
        tags: { type: "array", items: { type: "string" } },
        input: { type: "string" },
      },
      ["source", "count", "target", "tags", "input"],
    );
    expect(Object.values(f).map(shape)).toEqual([
      "string:positional",
      "number:flag",
      "string:positional",
      "string[]:flag",
      "string:positional",
    ]);
    expect(Object.values(f).every((field) => field.required)).toBe(true);
  });

  it("keeps the names of the common options free", () => {
    const f = fieldsOf(Object.fromEntries(RESERVED_FLAGS.map((name) => [name, { type: "string" }])));
    expect(Object.values(f).map(shape)).toEqual(RESERVED_FLAGS.map(() => "string:input-only"));
  });

  it("carries description and default for the help", () => {
    const f = fieldsOf({
      severity: { enum: ["error", "info"], default: "info", description: "Lowest severity." },
      plain: { type: "string", description: 3 },
    });
    expect(f["severity"]).toMatchObject({
      description: "Lowest severity.",
      defaultValue: "info",
      flag: "severity",
    });
    expect(f["plain"]).toMatchObject({ description: undefined, defaultValue: undefined, required: false });
  });

  it("accepts inputs without properties or required list", () => {
    expect(inputFields(entry({ type: "object" }))).toEqual([]);
    expect(
      inputFields(entry({ type: "object", properties: { a: { type: "string" } }, required: "a" })),
    ).toEqual([expect.objectContaining({ name: "a", required: false, use: "flag" })]);
  });

  it("classifies every field of the real catalog without error", () => {
    const fields = getCommandRuntime().contracts.commands.flatMap((e) => inputFields(e));
    expect(fields.length).toBeGreaterThan(0);
    const byName = Object.fromEntries(
      getCommandRuntime()
        .contracts.commands.filter((e) =>
          ["element.get", "workspace.check", "element.update"].includes(e.name),
        )
        .flatMap((e) => inputFields(e).map((f) => [`${e.name}:${f.name}`, shape(f)])),
    );
    expect(byName).toEqual({
      "element.get:file": "string:flag",
      "element.get:ref": "string:positional",
      "element.get:repository": "string:flag",
      "element.get:versionDate": "boolean:flag",
      "element.get:view": "string:flag",
      "workspace.check:changedFiles": "string[]:flag",
      "workspace.check:changedSince": "string:flag",
      "workspace.check:failOn": "string:flag",
      "workspace.check:severity": "string:flag",
      "element.update:ref": "string:positional",
      "element.update:title": "string:flag",
      "element.update:text": "string:flag",
      "element.update:set": "complex:input-only",
      "element.update:unset": "string[]:flag",
    });
  });
});
