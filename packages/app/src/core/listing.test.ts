import type { CatalogEntry } from "@reqseq/core";
import { loadContracts } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { listedEntry } from "./listing.js";

const contracts = loadContracts();
const { schemas } = contracts;
const common = schemas.find((schema) => String(schema["$id"]).endsWith("/common.schema.json"));
const problemCodes = (common?.["$defs"] as Record<string, { enum: string[] }>)["problemCode"]?.enum;

const entry = (name: string): CatalogEntry => {
  const found = contracts.entry(name);
  if (found === undefined) {
    throw new Error(`no command ${name}`);
  }
  return found;
};
const listed = (name: string): CatalogEntry => listedEntry(entry(name), schemas);

/** A test entry with the given arguments and input properties. */
const test = (args: CatalogEntry["arguments"], properties: Record<string, unknown>): CatalogEntry => ({
  ...entry("hint.list"),
  arguments: args,
  input: { type: "object", properties },
});

describe("the catalog entries the windows get (SR-108)", () => {
  it("gives the problem codes of List hints and Confirm hints inline, for their list fields `kind` (#1575)", () => {
    expect(problemCodes?.length).toBeGreaterThan(0);
    const kind = (name: string) =>
      (listed(name).input as { properties: Record<string, { items?: { enum?: unknown }; enum?: unknown }> })
        .properties["kind"];
    expect(kind("hint.list")).toMatchObject({ type: "array", items: { enum: problemCodes } });
    expect(kind("hint.list")?.items).not.toHaveProperty("$ref");
    expect(kind("hint.confirm")?.enum ?? kind("hint.confirm")?.items?.enum).toEqual(problemCodes);
  });

  it("keeps an inline enum, a field that is no choice and a reference that leads to no enum as they are", () => {
    const inline = listed("element.list");
    expect(inline).toEqual(entry("element.list"));
    const args: CatalogEntry["arguments"] = [
      { field: "a", complete: "choice" },
      { field: "b", complete: "choice" },
      { field: "c", complete: "choice" },
      { field: "d", complete: "text" },
      { field: "missing", complete: "choice" },
    ];
    const properties = {
      a: { $ref: "../common.schema.json#/$defs/problemCode", description: "One code." },
      b: { $ref: "../common.schema.json#/$defs/uuid" },
      c: { type: "array", items: { $ref: "../nowhere.schema.json#/$defs/x" } },
      d: { $ref: "../common.schema.json#/$defs/problemCode" },
    };
    expect(listedEntry(test(args, properties), schemas).input).toEqual({
      type: "object",
      properties: { ...properties, a: { description: "One code.", enum: problemCodes } },
    });
    const none = test([{ field: "d", complete: "text" }], properties);
    expect(listedEntry(none, schemas)).toBe(none);
    const empty = { ...entry("hint.list"), input: { type: "object" } };
    expect(listedEntry(empty, schemas)).toBe(empty);
  });
});
