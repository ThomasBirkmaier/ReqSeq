import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCHEMA_BASE,
  contractsBundle,
  describeViolations,
  fileSchemaValidator,
  loadContracts,
  schemaViolations,
} from "./contracts.js";

const schemasDir = path.join(import.meta.dirname, "..", "..", "..", "..", "schemas");
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(schemasDir, file), "utf8"));

const entry = (
  name: string,
  input: object = { type: "object" },
  output: object = { type: "object" },
): object => ({
  name,
  summary: "Test-only command.",
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
  input,
  output,
});
const catalogOf = (...commands: object[]): object => ({ "logreq-catalog": 1, commands });

describe("loadContracts", () => {
  it("loads the catalog of this repository", () => {
    const contracts = loadContracts();
    const file = readJson("commands/catalog.json") as {
      readonly commands: readonly { readonly name: string }[];
    };
    expect(contracts.commands.map((c) => c.name)).toEqual(file.commands.map((c) => c.name));
    expect(contracts.entry("workspace.status")?.stage).toBe(1);
    expect(contracts.entry("no.such")).toBeUndefined();
    expect(contracts.schemas.map((s) => s["$id"])).toContain("https://logreq.dev/schemas/common.schema.json");
  });

  it("compiles the input and output schema of every catalog command", () => {
    const contracts = loadContracts();
    for (const command of contracts.commands) {
      expect(typeof contracts.validator(command.name, "input")).toBe("function");
      expect(typeof contracts.validator(command.name, "output")).toBe("function");
    }
  });

  it("resolves refs from command schemas into schemas/*.schema.json", () => {
    const contracts = loadContracts({
      catalog: catalogOf(
        entry("test.ref", {
          type: "object",
          properties: { id: { $ref: "../common.schema.json#/$defs/elementRef" } },
        }),
      ),
    });
    const valid = contracts.validator("test.ref", "input");
    expect(valid({ id: "SR-825b7146fb54" })).toBe(true);
    // An identifier may be any text (#305), but not empty or with spaces at either end.
    expect(valid({ id: "SR-036" })).toBe(true);
    expect(valid({ id: " SR-036" })).toBe(false);
    expect(valid({ id: "" })).toBe(false);
    expect(valid.schema).toMatchObject({ $id: `${SCHEMA_BASE}commands/test.ref.input.json` });
  });

  it("checks formats", () => {
    const contracts = loadContracts({
      catalog: catalogOf(entry("test.date", { type: "string", format: "date" })),
    });
    const valid = contracts.validator("test.date", "input");
    expect(valid("2026-10-24")).toBe(true);
    expect(valid("24.10.2026")).toBe(false);
  });

  it("fills defaults into input but never into output", () => {
    const schema = { type: "object", properties: { limit: { type: "integer", default: 50 } } };
    const contracts = loadContracts({ catalog: catalogOf(entry("test.defaults", schema, schema)) });
    const input: Record<string, unknown> = {};
    expect(contracts.validator("test.defaults", "input")(input)).toBe(true);
    expect(input).toEqual({ limit: 50 });
    const output: Record<string, unknown> = {};
    expect(contracts.validator("test.defaults", "output")(output)).toBe(true);
    expect(output).toEqual({});
  });

  it("compiles each validator once", () => {
    const contracts = loadContracts({ catalog: catalogOf(entry("test.once")) });
    expect(contracts.validator("test.once", "input")).toBe(contracts.validator("test.once", "input"));
    expect(contracts.validator("test.once", "input")).not.toBe(contracts.validator("test.once", "output"));
  });

  it("refuses validators for unknown commands", () => {
    expect(() => loadContracts({ catalog: catalogOf() }).validator("no.such", "input")).toThrow(
      "no catalog entry no.such",
    );
  });

  it("rejects a catalog that does not match catalog.meta.schema.json", () => {
    expect(() => loadContracts({ catalog: { "logreq-catalog": 1 } })).toThrow(
      /invalid command catalog: \(root\) must/,
    );
    expect(() => loadContracts({ catalog: catalogOf({ ...entry("test.x"), effect: "write-git" }) })).toThrow(
      /\/commands\/0\/effect must be equal to one of the allowed values/,
    );
  });

  it("rejects a catalog that lists a command twice", () => {
    expect(() => loadContracts({ catalog: catalogOf(entry("test.twice"), entry("test.twice")) })).toThrow(
      "invalid command catalog: test.twice is listed twice",
    );
  });

  it("bundles exactly the schemas and the catalog of schemas/ (pnpm contracts:generate)", () => {
    const files = fs
      .readdirSync(schemasDir)
      .filter((f) => f.endsWith(".schema.json"))
      .sort();
    expect(contractsBundle.schemas).toEqual(files.map(readJson));
    expect(contractsBundle.catalogMeta).toEqual(readJson("commands/catalog.meta.schema.json"));
    expect(contractsBundle.catalog).toEqual(readJson("commands/catalog.json"));
  });
});

describe("schema violations", () => {
  it("turns Ajv errors into plain data and text", () => {
    const violations = schemaViolations([
      {
        instancePath: "/id",
        schemaPath: "#/x",
        keyword: "pattern",
        params: { pattern: "^x$" },
        message: "must match",
      },
      { instancePath: "", schemaPath: "#/y", keyword: "required", params: { missingProperty: "id" } },
    ]);
    expect(violations).toEqual([
      { path: "/id", keyword: "pattern", message: "must match", params: { pattern: "^x$" } },
      { path: "", keyword: "required", message: "required", params: { missingProperty: "id" } },
    ]);
    expect(describeViolations(violations)).toBe("/id must match; (root) required");
  });

  it("handles missing error lists", () => {
    expect(schemaViolations(null)).toEqual([]);
    expect(schemaViolations(undefined)).toEqual([]);
  });
});

describe("fileSchemaValidator", () => {
  it("validates a file against its format schema, with refs into common.schema.json", () => {
    const validate = fileSchemaValidator("workspace.schema.json");
    expect(fileSchemaValidator("workspace.schema.json")).toBe(validate);
    const file = {
      "logreq-workspace": 1,
      name: "W",
      repositories: [{ name: "w", url: "u" }],
      metamodel: { repository: "w", path: "model" },
    };
    expect(validate(file)).toBe(true);
    // No defaults are filled in: the file stays as it was read.
    expect(file.repositories[0]).toEqual({ name: "w", url: "u" });
    expect(validate({ ...file, metamodel: { repository: "w", path: "../up" } })).toBe(false);
    expect(schemaViolations(validate.errors)[0]?.path).toBe("/metamodel/path");
  });

  it("throws for a name that is not a schema", () => {
    expect(() => fileSchemaValidator("nope.schema.json")).toThrow("no schema nope.schema.json in schemas/");
  });
});
