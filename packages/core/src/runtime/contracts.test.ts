import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The texts users read are bundled without internal references (#642).
import { userTexts } from "../../../../scripts/contracts/user-text.mjs";
import {
  SCHEMA_BASE,
  contractsBundle,
  describeViolations,
  fileSchemaErrors,
  fileSchemaValidator,
  loadContracts,
  schemaViolations,
} from "./contracts.js";

const schemasDir = path.join(import.meta.dirname, "..", "..", "..", "..", "schemas");
const readJson = (file: string): unknown =>
  userTexts(JSON.parse(fs.readFileSync(path.join(schemasDir, file), "utf8")) as unknown);

const entry = (
  name: string,
  input: object = { type: "object" },
  output: object = { type: "object" },
): object => ({
  name,
  title: "Test command",
  summary: "Test-only command.",
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
  arguments: [],
  input,
  output,
});
const catalogOf = (...commands: object[]): object => ({ "reqseq-catalog": 1, commands });

describe("loadContracts", () => {
  it("loads the catalog of this repository", () => {
    const contracts = loadContracts();
    const header = readJson("commands/catalog.header.json") as { readonly order: readonly string[] };
    expect(contracts.commands.map((c) => c.name)).toEqual(header.order);
    expect(contracts.entry("workspace.status")?.stage).toBe(1);
    expect(contracts.entry("no.such")).toBeUndefined();
    expect(contracts.schemas.map((s) => s["$id"])).toContain("https://reqseq.dev/schemas/common.schema.json");
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
    expect(() => loadContracts({ catalog: { "reqseq-catalog": 1 } })).toThrow(
      /invalid command catalog: \(root\) must/,
    );
    expect(() => loadContracts({ catalog: catalogOf({ ...entry("test.x"), effect: "write-git" }) })).toThrow(
      /\/commands\/0\/effect must be equal to one of the allowed values/,
    );
  });

  it("checks the bundled catalog as a catalog passed in, which a start skips (#178)", () => {
    // pnpm schemas:check does it on every pull request; this keeps the guarantee in core's own suite.
    const checked = loadContracts({ catalog: contractsBundle.catalog });
    const started = loadContracts();
    expect(started.commands.map((c) => c.name)).toEqual(checked.commands.map((c) => c.name));
  });

  it("keeps the output schemas of a catalog passed in apart from the bundled ones, in either order", () => {
    // A product name with another output: the shared validators of a start must not answer for it.
    const other = (): ReturnType<typeof loadContracts> =>
      loadContracts({ catalog: catalogOf(entry("element.get", { type: "object" }, { type: "object" })) });
    const value = { zzz: "x" };
    const before = other();
    expect(loadContracts().validator("element.get", "output")(value)).toBe(false);
    expect(before.validator("element.get", "output")(value)).toBe(true);
    expect(other().validator("element.get", "output")(value)).toBe(true);
    expect(loadContracts().validator("element.get", "output")(value)).toBe(false);
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
    // One file per command, `<name>.json`, besides the header and the meta-schema (ADR-0002, #528).
    const commandFiles = fs
      .readdirSync(path.join(schemasDir, "commands"), { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".json"))
      .map((d) => d.name)
      .filter((f) => f !== "catalog.header.json" && f !== "catalog.meta.schema.json")
      .sort();
    const { commands } = contractsBundle.catalog as {
      readonly commands: readonly { readonly name: string }[];
    };
    expect(commands.map((c) => `${c.name}.json`).sort()).toEqual(commandFiles);
    for (const command of commands) {
      expect(command).toEqual(readJson(`commands/${command.name}.json`));
    }
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
      "reqseq-workspace": 1,
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
    expect(() => fileSchemaErrors("nope.schema.json", {})).toThrow("no schema nope.schema.json in schemas/");
  });

  it("gives the errors of a refused file with their schemas, none for a valid one (#160)", () => {
    const file = { "reqseq-filter": 1, name: "F", where: { status: ["draft"] } };
    expect(fileSchemaErrors("filter.schema.json", file)).toEqual([]);
    const [error] = fileSchemaErrors("filter.schema.json", { ...file, name: 5 });
    expect(error?.instancePath).toBe("/name");
    expect(error?.parentSchema).toBeDefined();
  });
});
