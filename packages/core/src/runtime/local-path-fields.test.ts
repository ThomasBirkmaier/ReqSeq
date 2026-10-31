import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../catalog.js";
import { SCHEMA_BASE, loadContracts } from "./contracts.js";
import { localPathFields, localPathUses } from "./local-path-fields.js";

const contracts = loadContracts();
const LOCAL_PATH = "../common.schema.json#/$defs/localPath";
const fieldsOf = (schema: JsonSchema, schemas = contracts.schemas) =>
  localPathFields(schema, `${SCHEMA_BASE}commands/test.input.json`, schemas);

describe("the local path fields of a command input (SR-142)", () => {
  it("finds every localPath of the product catalog, by its definition", () => {
    const raw = fs.readFileSync(
      new URL("../../../../schemas/commands/catalog.json", import.meta.url),
      "utf8",
    );
    const inRaw = raw.split(`"$ref": "${LOCAL_PATH}"`).length - 1;
    const found = contracts.commands.flatMap((entry) =>
      localPathFields(entry.input, `${SCHEMA_BASE}commands/${entry.name}.input.json`, contracts.schemas).map(
        (field) => `${entry.name}:${field.map((part) => part ?? "[]").join(".")}`,
      ),
    );
    expect(found).toHaveLength(inRaw);
    expect(found).toContain("workspace.check:changedFiles.[]");
    expect(found).toContain("reqif.import:mapping");
  });

  it("follows anyOf, oneOf and $refs into other schemas, and a schema that refers back to itself", () => {
    const self: Record<string, unknown> = { type: "object" };
    self["properties"] = { again: self, name: { type: "string" } };
    const schema = {
      type: "object",
      properties: {
        a: { anyOf: [{ $ref: LOCAL_PATH }, { type: "null" }] },
        b: { oneOf: [{ type: "array", items: { $ref: LOCAL_PATH } }] },
        c: { $ref: "../common.schema.json#/$defs/key" },
        d: self,
      },
    };
    expect(fieldsOf(schema)).toEqual([["a"], ["b", null]]);
  });

  it("throws for a schema that refers back to itself and holds a local path", () => {
    const self: Record<string, unknown> = { type: "object" };
    self["properties"] = { again: self, file: { $ref: LOCAL_PATH } };
    expect(() => fieldsOf({ type: "object", properties: { d: self } })).toThrow(
      "a local path in the recursive schema at d.again would not be checked",
    );
  });

  it("throws for a local path under a keyword it does not follow", () => {
    expect(() => fieldsOf({ type: "object", additionalProperties: { $ref: LOCAL_PATH } })).toThrow(
      "a local path under additionalProperties of (input) would not be checked",
    );
    expect(() => fieldsOf({ type: "object", properties: { x: { allOf: [{ $ref: LOCAL_PATH }] } } })).toThrow(
      "under allOf of x",
    );
    expect(() =>
      fieldsOf({
        type: "object",
        properties: { x: { type: "array", items: { additionalProperties: { $ref: LOCAL_PATH } } } },
      }),
    ).toThrow("under additionalProperties of x.[]");
    expect(fieldsOf({ type: "object", allOf: [{ $ref: "../common.schema.json#/$defs/key" }] })).toEqual([]);
  });

  it("throws for a $ref that does not resolve and for a local path in an items array", () => {
    expect(() => fieldsOf({ type: "object", properties: { x: { $ref: "#/$defs/missing" } } })).toThrow(
      "the $ref #/$defs/missing at x does not resolve",
    );
    expect(() =>
      fieldsOf({ type: "object", properties: { x: { type: "array", items: [{ $ref: LOCAL_PATH }] } } }),
    ).toThrow("a local path in the items array of x would not be checked");
    expect(fieldsOf({ type: "array", items: [{ type: "string" }] })).toEqual([]);
  });

  it("needs the localPath definition", () => {
    expect(() => localPathFields({}, SCHEMA_BASE, [])).toThrow("no $defs/localPath");
  });

  it("gives the string values of the fields, named as in input errors", () => {
    const fields = [["file"], ["changedFiles", null], ["deep", "path"]];
    expect(
      localPathUses({ file: "a.xml", changedFiles: ["b.md", 3, "c.md"], deep: "no object" }, fields),
    ).toEqual([
      { field: "file", path: "a.xml" },
      { field: "changedFiles[0]", path: "b.md" },
      { field: "changedFiles[2]", path: "c.md" },
    ]);
    expect(localPathUses({ file: "a.xml" })).toEqual([]);
    expect(localPathUses({ changedFiles: "x", deep: { path: "d" } }, fields)).toEqual([
      { field: "deep.path", path: "d" },
    ]);
  });
});
