import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { loadContracts, BASE } from "./load.mjs";

const { ajv } = loadContracts();
const validate = (schema, data) => ajv.getSchema(BASE + schema)(data);
const id = "102ee39b-773f-4cd0-b414-825b7146fb54";

describe("contracts", () => {
  it("all schemas, the catalog and the examples are valid", () => {
    expect(() => execFileSync("node", ["scripts/contracts/validate-schemas.mjs"])).not.toThrow();
  });

  it("generated OpenAPI, MCP tool list, contracts bundle and TypeScript types are up to date", () => {
    expect(() => execFileSync("node", ["scripts/contracts/generate.mjs", "--check"])).not.toThrow();
  });

  it("catalog: a write command needs whileReadOnly with a reason, a read command has neither (#142)", () => {
    const entry = {
      name: "test.write",
      title: "Test command",
      summary: "A test command.",
      effect: "write-files",
      whileReadOnly: "refuse",
      whileReadOnlyReason: "A test write command.",
      stage: 1,
      implements: ["SR-011"],
      arguments: [],
      input: { type: "object" },
      output: { type: "object" },
    };
    const catalog = (...commands) => ({ "logreq-catalog": 1, commands });
    const meta = "commands/catalog.meta.schema.json";
    const { whileReadOnly, whileReadOnlyReason, ...write } = entry;
    expect(validate(meta, catalog(entry))).toBe(true);
    expect(validate(meta, catalog({ ...entry, whileReadOnly: "allow" }))).toBe(true);
    expect(validate(meta, catalog(write))).toBe(false);
    expect(validate(meta, catalog({ ...write, whileReadOnly }))).toBe(false);
    expect(validate(meta, catalog({ ...write, whileReadOnlyReason }))).toBe(false);
    expect(validate(meta, catalog({ ...entry, whileReadOnly: "ignore" }))).toBe(false);
    expect(validate(meta, catalog({ ...entry, whileReadOnlyReason: "Two\nlines of reason." }))).toBe(false);
    const read = { ...write, effect: "read" };
    expect(validate(meta, catalog(read))).toBe(true);
    expect(validate(meta, catalog({ ...read, whileReadOnly: "refuse" }))).toBe(false);
    expect(validate(meta, catalog({ ...read, whileReadOnlyReason }))).toBe(false);
  });

  it("element: rejects UUID v7 and accepts unknown property keys", () => {
    const v7 = "01928c6e-5a8b-7c3d-9e1f-0a2b3c4d5e6f";
    expect(validate("element.schema.json", { id: v7, type: "need", status: "draft" })).toBe(false);
    expect(validate("element.schema.json", { id, type: "need", status: "draft", "customer-id": "X-1" })).toBe(
      true,
    );
  });

  it("a relation target never carries title and repository together (D-058)", () => {
    const target = { id, version: "n1:0123456789abcdef", title: "T", repository: "other" };
    const rt = "common.schema.json#/$defs/relationTarget";
    expect(validate(rt, target)).toBe(false);
    expect(validate(rt, { id, version: "n1:0123456789abcdef", repository: "other" })).toBe(true);
  });

  it("evidence record: verification needs method and item (D-026)", () => {
    const rec = {
      "logreq-record": 1,
      kind: "verification",
      element: id,
      version: "n1:0123456789abcdef",
      result: "passed",
      date: "2026-10-24T10:00:00Z",
    };
    expect(validate("evidence-record.schema.json", rec)).toBe(false);
    expect(validate("evidence-record.schema.json", { ...rec, kind: "validation" })).toBe(true);
  });
});
