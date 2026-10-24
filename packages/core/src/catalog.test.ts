import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_ERROR_CODES, CommandError, defineCommand } from "./catalog.js";
import { loadContracts } from "./runtime/contracts.js";

const schemasDir = path.join(import.meta.dirname, "..", "..", "..", "schemas");

interface ErrorDef {
  readonly properties: { readonly code: { readonly enum: readonly string[] } };
}
const common = JSON.parse(fs.readFileSync(path.join(schemasDir, "common.schema.json"), "utf8")) as {
  readonly $defs: { readonly error: ErrorDef };
};

describe("command definitions", () => {
  it("returns the definition unchanged", () => {
    const def = { name: "test.echo", run: (_ctx: unknown, input: string) => Promise.resolve(input) };
    expect(defineCommand(def)).toBe(def);
  });
});

describe("CommandError", () => {
  it("carries code and message", () => {
    const err = new CommandError("element.not-found", "No element SR-123456");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CommandError");
    expect(err.code).toBe("element.not-found");
    expect(err.message).toBe("No element SR-123456");
    expect(err.details).toBeUndefined();
    expect(err.toJSON()).toEqual({ code: "element.not-found", message: "No element SR-123456" });
  });

  it("carries details and cause; the cause stays out of the error object", () => {
    const cause = new Error("disk");
    const err = new CommandError("internal", "failed", { command: "x.y" }, { cause });
    expect(err.details).toEqual({ command: "x.y" });
    expect(err.cause).toBe(cause);
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      code: "internal",
      message: "failed",
      details: { command: "x.y" },
    });
  });

  it("serialises to the error object of common.schema.json", () => {
    const contracts = loadContracts({
      catalog: {
        "logreq-catalog": 1,
        commands: [
          {
            name: "test.fail",
            summary: "Always fails (test only).",
            effect: "read",
            stage: 1,
            implements: ["SR-080"],
            input: { type: "object" },
            output: { $ref: "../common.schema.json#/$defs/error" },
          },
        ],
      },
    });
    const valid = contracts.validator("test.fail", "output");
    expect(valid(new CommandError("input.invalid", "bad").toJSON())).toBe(true);
    expect(valid(new CommandError("internal", "bad", { errors: [] }).toJSON())).toBe(true);
  });

  it("knows exactly the codes of common.schema.json#/$defs/error", () => {
    expect([...COMMAND_ERROR_CODES]).toEqual(common.$defs.error.properties.code.enum);
  });
});
