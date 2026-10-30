import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  CatalogCommand,
  CommandContext,
  CommandDefinition,
  CommandEffect,
  CommandErrorClass,
  CommandErrorCode,
  CommandInput,
  CommandName,
  CommandOutput,
} from "./catalog.js";
import {
  COMMAND_ERROR_CLASSES,
  CommandError,
  commandErrorOrThrow,
  defineCommand,
  defineTestCommand,
  errorClass,
} from "./catalog.js";
import type { CommandTypes, ElementListInput, WorkspaceStatusOutput } from "./generated/types.js";
import { loadContracts } from "./runtime/contracts.js";

const schemasDir = path.join(import.meta.dirname, "..", "..", "..", "schemas");

interface ErrorDef {
  readonly properties: { readonly code: { readonly enum: readonly string[] } };
}
const common = JSON.parse(fs.readFileSync(path.join(schemasDir, "common.schema.json"), "utf8")) as {
  readonly $defs: { readonly error: ErrorDef };
};

/** Every code of the generated union; the `Record` type of COMMAND_ERROR_CLASSES makes it exhaustive. */
const errorCodes = Object.keys(COMMAND_ERROR_CLASSES) as CommandErrorCode[];

describe("command definitions", () => {
  it("defines test-only commands with given types and returns them unchanged", () => {
    const def = defineTestCommand<{ readonly n: number }, string>({
      name: "test.count",
      run: (ctx, input) => {
        expectTypeOf(ctx).toEqualTypeOf<CommandContext>();
        expectTypeOf(input).toEqualTypeOf<{ readonly n: number }>();
        return Promise.resolve(String(input.n));
      },
    });
    expectTypeOf(def).toEqualTypeOf<CommandDefinition<{ readonly n: number }, string>>();
    expect(defineTestCommand(def)).toBe(def);
  });

  it("returns the definition unchanged, typed from the catalog entry its name picks", () => {
    const status = defineCommand({
      name: "workspace.status",
      run: (_ctx, input) => {
        expectTypeOf(input).toEqualTypeOf<CommandInput<"workspace.status">>();
        return Promise.resolve({
          name: "w",
          repositories: [],
          metamodel: { repository: "w", path: "metamodel", valid: true },
          readOnly: false,
          problems: [],
        });
      },
    });
    expectTypeOf(status).toEqualTypeOf<CatalogCommand<"workspace.status">>();
    expectTypeOf(status.run).returns.toEqualTypeOf<Promise<WorkspaceStatusOutput>>();
    const def: CatalogCommand<"workspace.status"> = { name: "workspace.status", run: status.run };
    expect(defineCommand(def)).toBe(def);
  });

  it("types input and output of every catalog command from the generated types", () => {
    expectTypeOf<CommandName>().toEqualTypeOf<keyof CommandTypes>();
    expectTypeOf<"element.list">().toExtend<CommandName>();
    expectTypeOf<"test.echo">().not.toExtend<CommandName>();
    expectTypeOf<CommandInput<"element.list">>().toEqualTypeOf<ElementListInput>();
    // A catalog `default` makes the property required: the input validator fills it in.
    expectTypeOf<ElementListInput["limit"]>().toEqualTypeOf<number>();
    // Also through $ref: filter.schema.json#/$defs/sortKey has `order` with a default.
    expectTypeOf<NonNullable<ElementListInput["sort"]>[number]["order"]>().toEqualTypeOf<"asc" | "desc">();
    expectTypeOf<ElementListInput>().pick<"withText">().toEqualTypeOf<{ readonly withText?: boolean }>();
    expectTypeOf<CommandOutput<"workspace.status">>().toEqualTypeOf<WorkspaceStatusOutput>();
    expectTypeOf<CommandEffect>().toEqualTypeOf<"read" | "write-files">();
    expectTypeOf<Parameters<CatalogCommand<"element.list">["run"]>>().toEqualTypeOf<
      [CommandContext, ElementListInput]
    >();
  });
});

describe("CommandError", () => {
  it("commandErrorOrThrow gives a CommandError back and throws any other error again", () => {
    const refused = new CommandError("input.invalid", "No");
    expect(commandErrorOrThrow(refused)).toBe(refused);
    const bug = new TypeError("bug");
    expect(() => commandErrorOrThrow(bug)).toThrow(bug);
  });

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
        "reqseq-catalog": 1,
        commands: [
          {
            name: "test.fail",
            title: "Test command",
            summary: "Always fails (test only).",
            effect: "read",
            stage: 1,
            implements: ["SR-080"],
            arguments: [],
            input: { type: "object" },
            output: { type: "object", $ref: "../common.schema.json#/$defs/error" },
          },
        ],
      },
    });
    const valid = contracts.validator("test.fail", "output");
    expect(valid(new CommandError("input.invalid", "bad").toJSON())).toBe(true);
    expect(valid(new CommandError("internal", "bad", { errors: [] }).toJSON())).toBe(true);
  });

  it("has the generated type of exactly the codes of common.schema.json#/$defs/error", () => {
    expectTypeOf(COMMAND_ERROR_CLASSES).toEqualTypeOf<
      Readonly<Record<CommandErrorCode, CommandErrorClass>>
    >();
    expect(errorCodes).toEqual(common.$defs.error.properties.code.enum);
  });
});

describe("error classes", () => {
  it("classify exactly the error codes, in schema order", () => {
    expect(errorCodes).toEqual(common.$defs.error.properties.code.enum);
  });

  it("map each code to the table of ADR-0009", () => {
    const byClass = (cls: string): string[] => errorCodes.filter((code) => errorClass(code) === cls);
    expect(byClass("input")).toEqual([
      "input.invalid",
      "ref.ambiguous",
      "relation.not-allowed",
      "variant.nested",
      "reqif.invalid",
      "reqif.unmapped",
    ]);
    expect(byClass("not-found")).toEqual([
      "ref.unknown",
      "workspace.not-found",
      "element.not-found",
      "git.commit-not-found",
      "file.folder-missing",
    ]);
    expect(byClass("conflict")).toEqual([
      "workspace.read-only",
      "element.read-only",
      "metamodel.meaning-unassigned",
      "baseline.uncommitted-changes",
      "baseline.exists",
      "file.changed-on-disk",
      "file.faulty",
      "file.unreadable",
      "file.read-only",
      "file.not-regular",
    ]);
    expect(byClass("unavailable")).toEqual(["git.unavailable"]);
    expect(byClass("not-implemented")).toEqual(["command.not-implemented"]);
    expect(byClass("internal")).toEqual(["internal"]);
  });
});
