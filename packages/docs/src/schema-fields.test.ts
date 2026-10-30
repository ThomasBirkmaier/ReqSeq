import { contractsBundle } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { fieldRows, refName, resolveRef, typeText } from "./schema-fields.js";

const context = { schemas: contractsBundle.schemas };

describe("schema fields", () => {
  it("resolves a $ref of the catalog to its definition or its file", () => {
    expect(resolveRef("../common.schema.json#/$defs/uuid", context)?.["type"]).toBe("string");
    expect(resolveRef("../reqif-mapping.schema.json", context)?.["$id"]).toMatch(/reqif-mapping/);
    expect(resolveRef("../common.schema.json#/$defs/none", context)).toBeUndefined();
    expect(refName("../common.schema.json#/$defs/uuid")).toBe("uuid");
    expect(refName("../data-export.schema.json")).toBe("data-export");
  });

  it("names every kind of type", () => {
    expect(typeText({ enum: ["a", 1] })).toBe('one of `"a"`, `1`');
    expect(typeText({ const: null })).toBe("`null`");
    expect(typeText({ anyOf: [{ type: "string" }, { type: "integer" }] })).toBe("`string` or `integer`");
    expect(typeText({ oneOf: [{ type: "boolean" }] })).toBe("`boolean`");
    expect(typeText({ allOf: [{ $ref: "#/$defs/a" }, { type: "object" }] })).toBe("`a` and `object`");
    expect(typeText({ allOf: [{ $ref: "#/$defs/relativePath" }, { minLength: 1 }] })).toBe("`relativePath`");
    expect(typeText({ allOf: [{ minLength: 1 }] })).toBe("`any`");
    expect(typeText({ type: "array", items: { type: "string" } })).toBe("array of `string`");
    expect(typeText({ type: "array" })).toBe("`array`");
    expect(typeText({ type: ["string", "null"] })).toBe("`string` or `null`");
    expect(typeText({})).toBe("`any`");
  });

  it("lists fields with nested objects and arrays of objects, descriptions from $refs and defaults", () => {
    const schema = {
      type: "object",
      required: ["id"],
      properties: {
        id: { $ref: "../common.schema.json#/$defs/uuid" },
        limit: { type: "integer", default: 10 },
        note: { type: "string", description: "A note.", default: "" },
        options: {
          type: "object",
          properties: {
            deep: { type: "object", properties: { deeper: { type: "object", properties: { x: {} } } } },
          },
        },
        items: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
        odd: true,
      },
    };
    const rows = fieldRows(schema, context);
    expect(rows.map((row) => row.field)).toEqual([
      "id",
      "limit",
      "note",
      "options",
      "options.deep",
      "options.deep.deeper",
      "items",
      "items[].name",
      "odd",
    ]);
    expect(rows[0]).toMatchObject({ required: true, type: "`uuid`" });
    expect(rows[0]?.description).not.toBe("");
    expect(rows[1]?.description).toBe("Default: `10`.");
    expect(rows[2]?.description).toBe('A note. Default: `""`.');
    expect(rows[8]).toMatchObject({ type: "`any`", required: false, description: "" });
    expect(fieldRows({ type: "object" }, context)).toEqual([]);
  });
});
