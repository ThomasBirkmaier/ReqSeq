import type { CatalogEntry, JsonSchema } from "@reqseq/core";
import { SCHEMA_BASE, loadContracts } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { cliUsage } from "./cli-usage.js";

const contracts = loadContracts();

/** A test entry `group.someAction` with the given input and arguments. */
const entry = (input: Record<string, unknown>, args: CatalogEntry["arguments"] = []): CatalogEntry => ({
  ...(contracts.entry("hint.list") as CatalogEntry),
  name: "group.someAction",
  arguments: args,
  input: { type: "object", ...input },
});

/** A schema file with `$defs` the fields can reference. */
const defs: JsonSchema = {
  $id: `${SCHEMA_BASE}defs.json`,
  $defs: {
    text: { type: "string" },
    deeper: { $ref: "#/$defs/text" },
    loop: { $ref: "#/$defs/loop" },
    count: { type: "integer" },
  },
};

const usage = (properties: Record<string, unknown>, args: CatalogEntry["arguments"] = []): string =>
  cliUsage(entry({ properties, required: Object.keys(properties) }, args), [defs]);

describe("the call on the command line in the command help (SR-210 AK3)", () => {
  it("[SR-210/AK-wz9v] names the group, the action in kebab-case and each required string as a positional argument", () => {
    expect(cliUsage(contracts.entry("element.get") as CatalogEntry, contracts.schemas)).toBe(
      "reqseq element get <ref> [options]",
    );
    expect(cliUsage(entry({}), [])).toBe("reqseq group some-action [options]");
    expect(cliUsage(entry({ properties: { a: { type: "string" } } }), [])).toBe(
      "reqseq group some-action [options]",
    );
  });

  it("reads the kind of a field as the CLI does", () => {
    expect(usage({ a: { type: "string" }, b: { type: "boolean" }, c: { type: "integer" } })).toBe(
      "reqseq group some-action <a> [options]",
    );
    // References, also through another one; one that leads nowhere or in a circle is no string.
    expect(
      usage({
        a: { $ref: "../defs.json#/$defs/deeper" },
        b: { $ref: "../defs.json#/$defs/missing" },
        c: { $ref: "../defs.json#/$defs/loop" },
        d: { $ref: "elsewhere.json#/$defs/text" },
      }),
    ).toBe("reqseq group some-action <a> [options]");
    // A const, an enum of texts, a string or null; not a number, an enum of numbers or only null.
    expect(
      usage({
        a: { const: "x" },
        b: { enum: ["x", "y", null] },
        c: { type: ["string", "null"] },
        d: { anyOf: [{ type: "string" }, { type: "null" }] },
        e: { const: 1 },
        f: { enum: [1, 2] },
        g: { type: "null" },
        h: { enum: [] },
        i: { type: ["string", "integer"] },
        j: { const: {} },
        k: { enum: [null] },
      }),
    ).toBe("reqseq group some-action <a> <b> <c> <d> [options]");
    // A number or a text is passed as text; a text or a list is not.
    expect(
      usage({
        a: { oneOf: [{ $ref: "../defs.json#/$defs/count" }, { type: "string" }] },
        b: { anyOf: [{ type: "string" }, { type: "array" }] },
        c: { anyOf: [{}, { type: "string" }] },
      }),
    ).toBe("reqseq group some-action <a> [options]");
    // allOf: every branch holds, one without a type only narrows.
    expect(
      usage({
        a: { allOf: [{ $ref: "../defs.json#/$defs/text" }, { not: { enum: ["id"] } }] },
        b: { type: "string", allOf: [{ type: "integer" }] },
        c: { allOf: [{ not: {} }] },
      }),
    ).toBe("reqseq group some-action <a> [options]");
    // Lists, objects and schemas that are no objects are no strings.
    expect(usage({ a: { type: "array", items: { type: "string" } }, b: { type: "object" }, c: true })).toBe(
      "reqseq group some-action [options]",
    );
  });

  it("names a positional argument by the flag of its catalog argument, else the field in kebab-case", () => {
    expect(
      usage({ someField: { type: "string" }, other: { type: "string" } }, [
        { field: "other", complete: "text", flag: "set" },
      ] as CatalogEntry["arguments"]),
    ).toBe("reqseq group some-action <some-field> <set> [options]");
  });
});
