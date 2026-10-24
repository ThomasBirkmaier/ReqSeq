import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createCommandRuntime, defineTestCommand, getCommandRuntime, loadContracts } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { catalogTools, serverTools, toolName } from "./tools.js";

const generated = path.join(import.meta.dirname, "..", "..", "..", "schemas", "generated", "mcp-tools.json");

describe("catalogTools", () => {
  it("gives exactly the tool list of schemas/generated/mcp-tools.json for the product catalog", async () => {
    const file = JSON.parse(await fs.readFile(generated, "utf8")) as Record<string, unknown>;
    const list = catalogTools(loadContracts());
    expect(list.tools).toEqual(file["tools"]);
    expect(list.$defs).toEqual(file["$defs"]);
  });

  it("refuses a $ref it cannot rewrite", () => {
    const catalog = {
      "logreq-catalog": 1,
      commands: [
        {
          name: "test.ref",
          summary: "Refers to a remote schema.",
          effect: "read",
          stage: 1,
          implements: ["SR-080"],
          input: { type: "object", properties: { a: { $ref: "https://example.com/a.json" } } },
          output: { type: "object" },
        },
      ],
    };
    expect(() => catalogTools(loadContracts({ catalog }))).toThrow(
      "unsupported $ref https://example.com/a.json",
    );
  });
});

describe("serverTools", () => {
  const catalog = {
    "logreq-catalog": 1,
    commands: [
      {
        name: "test.read",
        summary: "A read command with shared definitions.",
        effect: "read",
        stage: 1,
        implements: ["SR-080"],
        input: {
          type: "object",
          properties: {
            ref: { $ref: "../common.schema.json#/$defs/elementRef" },
            all: { $ref: "../common.schema.json" },
          },
        },
        output: { type: "object", properties: { problems: { type: "array" } } },
      },
      {
        name: "test.write",
        summary: "A write command, never implemented here.",
        effect: "write-files",
        stage: 2,
        implements: ["SR-080"],
        input: { type: "object" },
        output: { type: "object" },
      },
    ],
  };
  const runtime = createCommandRuntime({
    contracts: loadContracts({ catalog }),
    commands: [defineTestCommand({ name: "test.read", run: () => Promise.resolve({}) })],
  });

  it("names tools group_action and marks read commands and missing implementations", () => {
    const tools = serverTools(runtime);
    expect(tools.map((t) => [t.name, t.command, t.annotations.readOnlyHint, t.description])).toEqual([
      ["test_read", "test.read", true, "A read command with shared definitions."],
      ["test_write", "test.write", false, "A write command, never implemented here. (not implemented yet)"],
    ]);
    expect(tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(toolName("element.setStatus")).toBe("element_setStatus");
  });

  it("attaches only the definitions a schema uses, so every $ref resolves", () => {
    const [read, write] = serverTools(runtime);
    expect(Object.keys(read?.inputSchema["$defs"] ?? {})).toEqual(["common", "filter"]);
    expect(read?.inputSchema["properties"]).toEqual({
      ref: { $ref: "#/$defs/common/$defs/elementRef" },
      all: { $ref: "#/$defs/common" },
    });
    expect(read?.outputSchema["$defs"]).toBeUndefined();
    expect(write?.inputSchema).toEqual({ type: "object" });
  });

  it("gives self-contained schemas for every product command", () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats.default(ajv);
    for (const tool of serverTools(getCommandRuntime())) {
      expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow();
      expect(() => ajv.compile(tool.outputSchema), tool.name).not.toThrow();
    }
  });
});
