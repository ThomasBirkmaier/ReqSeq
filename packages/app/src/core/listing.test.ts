import { readFileSync } from "node:fs";
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

/** The description of the field `field` of `name` as the windows get it. */
const listedProperty = (name: string, field: string): unknown =>
  (listed(name).input as { properties: Record<string, { description?: unknown }> }).properties[field]
    ?.description;

/** The description of the field `field` of `name` as its file in `schemas/commands/` has it. */
const sourceDescription = (name: string, field: string): string => {
  const file = new URL(`../../../../schemas/commands/${name}.json`, import.meta.url);
  const source = JSON.parse(readFileSync(file, "utf8")) as {
    input: { properties: Record<string, { description: string }> };
  };
  return source.input.properties[field]?.description ?? "";
};

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
    const inline = listed("element.get");
    expect(inline).toEqual(entry("element.get"));
    const args: CatalogEntry["arguments"] = [
      { field: "a", complete: "choice" },
      { field: "b", complete: "choice" },
      { field: "c", complete: "choice" },
      { field: "d", complete: "text" },
      { field: "missing", complete: "choice" },
    ];
    const properties = {
      a: { $ref: "../common.schema.json#/$defs/problemCode", description: "One code." },
      b: { $ref: "../common.schema.json#/$defs/uuid", description: "One UUID." },
      c: { type: "array", items: { $ref: "../nowhere.schema.json#/$defs/x" } },
      d: { $ref: "../common.schema.json#/$defs/problemCode", description: "No choice." },
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

  it("gives a condition, a sort and a grouping their whole schema inline, the recursion of a condition as a reference (SR-215)", () => {
    const fields = (
      listed("perspective.save").input as { properties: Record<string, Record<string, unknown>> }
    ).properties;
    /** Every `$ref` in `node`. */
    const refsIn = (node: unknown): string[] =>
      Array.isArray(node)
        ? node.flatMap(refsIn)
        : typeof node === "object" && node !== null
          ? Object.entries(node).flatMap(([key, value]) =>
              key === "$ref" && typeof value === "string" ? [value] : refsIn(value),
            )
          : [];
    const condition = "https://reqseq.dev/schemas/filter.schema.json#/$defs/condition";
    const where = fields["where"] ?? {};
    // Only the references back to the condition itself stay, absolute (`all`, `any`, `not`).
    expect(new Set(refsIn(where))).toEqual(new Set([condition]));
    expect(where["description"]).toBe(sourceDescription("perspective.save", "where"));
    const branches = where["oneOf"] as { properties: Record<string, Record<string, unknown>> }[];
    const part = (name: string): Record<string, unknown> | undefined =>
      branches.find((branch) => name in branch.properties)?.properties[name];
    expect(part("all")?.["items"]).toEqual({ $ref: condition });
    const statuses = (name: string): unknown =>
      (
        (schemas.find((s) => String(s["$id"]).endsWith("/common.schema.json"))?.["$defs"] ?? {}) as Record<
          string,
          { enum: unknown }
        >
      )[name]?.enum;
    expect((part("verification")?.["items"] as { enum: unknown }).enum).toEqual(
      statuses("verificationStatus"),
    );
    expect((part("validation")?.["items"] as { enum: unknown }).enum).toEqual(statuses("validationStatus"));
    // The relation condition with its meanings and directions.
    expect(JSON.stringify(where)).toContain('"enum":["derivation","replacement","succession","exclusion"]');
    expect(JSON.stringify(where)).toContain('"enum":["up","down","evidence"]');
    // A sort: the keys of `by` and the orders; a grouping: its fixed keys.
    const sortKey = (fields["sort"]?.["items"] ?? {}) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(refsIn(fields["sort"])).toEqual([]);
    expect((sortKey.properties["by"]?.["anyOf"] as { enum?: unknown }[])[0]?.enum).toEqual([
      "id",
      "identifier",
      "hierarchy",
      "type",
      "status",
      "title",
    ]);
    expect(sortKey.properties["order"]?.["enum"]).toEqual(["asc", "desc"]);
    expect(refsIn(fields["group"])).toEqual([]);
    expect((fields["group"]?.["anyOf"] as { enum?: unknown }[])[0]?.enum).toEqual([
      "type",
      "status",
      "package",
    ]);
    expect(fields["group"]?.["description"]).toBe(sourceDescription("perspective.save", "group"));
    // A reference that names nothing stays, absolute.
    const nowhere = test([{ field: "where", complete: "condition" }], {
      where: { $ref: "../nowhere.schema.json#/$defs/x", description: "Nowhere." },
    });
    expect(listedEntry(nowhere, schemas).input).toEqual({
      type: "object",
      properties: {
        where: { $ref: "https://reqseq.dev/schemas/nowhere.schema.json#/$defs/x", description: "Nowhere." },
      },
    });
    // Not the other arguments: a filter name stays as the catalog has it.
    expect(fields["filter"]).toEqual(
      (entry("perspective.save").input as { properties: Record<string, unknown> }).properties["filter"],
    );
  });

  it("[SR-210/AK-cbzd] gives every argument the catalog's description, its own or else the one of its value type", () => {
    const definition = (ref: string): { description?: unknown } => {
      const [file = "", pointer = ""] = ref.replace(/^\.\.\//, "").split("#");
      const schema = schemas.find((s) => String(s["$id"]).endsWith(`/${file}`)) as Record<string, unknown>;
      const name = pointer.split("/").at(-1) ?? "";
      return (pointer === "" ? schema : (schema["$defs"] as Record<string, object>)[name]) ?? {};
    };
    let fromType = 0;
    for (const command of contracts.commands) {
      const own = (command.input as { properties: Record<string, Record<string, unknown>> }).properties;
      const shown = (
        listedEntry(command, schemas).input as { properties: Record<string, { description?: unknown }> }
      ).properties;
      for (const { field } of command.arguments) {
        const property = own[field] ?? {};
        const items = property["items"] as Record<string, unknown> | undefined;
        const ref = (property["$ref"] ?? items?.["$ref"]) as string | undefined;
        const expected =
          property["description"] ?? (ref === undefined ? undefined : definition(ref).description);
        fromType += property["description"] === undefined ? 1 : 0;
        expect(typeof expected, `${command.name} ${field}`).toBe("string");
        expect(shown[field]?.description, `${command.name} ${field}`).toBe(expected);
      }
    }
    // An argument without its own description shows the one of its value type.
    expect(fromType).toBeGreaterThan(0);
    expect(listedProperty("baseline.create", "name")).toBe(
      definition("../baseline.schema.json#/$defs/name").description,
    );
    // The text is the catalog's without the references to the specification its source keeps.
    const source = sourceDescription("element.update", "text");
    expect(source).toContain("(ADR-0004)");
    expect(listedProperty("element.update", "text")).toBe(source.replace(" (ADR-0004)", ""));
  });
});
