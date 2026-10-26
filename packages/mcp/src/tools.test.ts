import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createCommandRuntime, defineTestCommand, getCommandRuntime, loadContracts } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { catalogTools, serverTools, toolName } from "./tools.js";

const generated = path.join(import.meta.dirname, "..", "..", "..", "schemas", "generated", "mcp-tools.json");

/** Every `pattern` of a JSON document, for the check that external clients can compile them. */
const patternsOf = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(patternsOf);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "pattern" && typeof inner === "string" ? [inner] : patternsOf(inner),
  );
};

describe("catalogTools", () => {
  it("gives exactly the tool list of schemas/generated/mcp-tools.json for the product catalog", async () => {
    const file = JSON.parse(await fs.readFile(generated, "utf8")) as Record<string, unknown>;
    const list = catalogTools(loadContracts());
    expect(list.tools).toEqual(file["tools"]);
    expect(list.$defs).toEqual(file["$defs"]);
  });

  it("publishes only patterns a client compiles without the Unicode flag (D-029, #305)", async () => {
    const published = JSON.parse(await fs.readFile(generated, "utf8")) as {
      $defs: { common: { $defs: { elementRef: { pattern: string } } } };
    };
    const patterns = patternsOf(published);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      // Without the u flag, as many clients compile them: \p{...} would be literal text.
      expect(() => new RegExp(pattern)).not.toThrow();
      expect(pattern).not.toMatch(/\\[pP]\{/);
    }
    const elementRef = new RegExp(published.$defs.common.$defs.elementRef.pattern);
    for (const ref of ["SR-3c90b0", "SR-036", "sr-5a8b25", "Stufe 2 – Spec-ID ä"]) {
      expect(elementRef.test(ref)).toBe(true);
    }
    for (const ref of ["", " SR-036", "SR-036 ", "SR-\u0007036", "a\tb", "SR-036\u0085"]) {
      expect(elementRef.test(ref)).toBe(false);
    }
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
            ref: { $ref: "../common.schema.json#/$defs/view" },
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

  it("names tools group_action, marks read commands and leaves out commands without implementation", () => {
    const tools = serverTools(runtime);
    expect(tools.map((t) => [t.name, t.command, t.annotations.readOnlyHint, t.description])).toEqual([
      ["test_read", "test.read", true, "A read command with shared definitions."],
    ]);
    expect(tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(toolName("element.setStatus")).toBe("element_setStatus");
  });

  it("attaches only the definitions a schema reaches, one by one and flat, so every $ref resolves", () => {
    const [read] = serverTools(runtime);
    const defs = read?.inputSchema["$defs"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(defs)).toEqual(["common", "common.elementRef", "common.view"]);
    expect(read?.inputSchema["properties"]).toEqual({
      ref: { $ref: "#/$defs/common.view" },
      all: { $ref: "#/$defs/common" },
    });
    expect(defs["common.view"]?.["anyOf"]).toEqual([
      { const: "core" },
      { $ref: "#/$defs/common.elementRef" },
    ]);
    // A whole file without its definitions: those are entries of their own.
    expect(defs["common"]?.["$defs"]).toBeUndefined();
    expect(read).not.toHaveProperty("outputSchema");
  });

  it("gives self-contained schemas for every implemented product command, and only for those", () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats.default(ajv);
    const product = getCommandRuntime();
    const tools = serverTools(product);
    expect(tools.map((t) => t.command)).toEqual(
      product.contracts.commands.map((e) => e.name).filter((name) => product.commands.has(name)),
    );
    for (const tool of tools) {
      expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow();
    }
  });

  it("validates like the catalog: flat schemas accept and refuse what core accepts and refuses", () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats.default(ajv);
    const product = getCommandRuntime();
    const get = serverTools(product).find((t) => t.command === "element.get");
    const valid = ajv.compile(get?.inputSchema ?? {});
    const core = product.contracts.validator("element.get", "input");
    for (const input of [
      { ref: "SR-825b71" },
      { ref: "825b7146-fb54-4c3e-9d1a-0a1b2c3d4e5f" },
      { ref: "x" },
      {},
    ]) {
      expect([input, valid(structuredClone(input))]).toEqual([input, core(structuredClone(input))]);
    }
  });
});

/** The node at the JSON pointer `ref` (`#/a/b`) in `root`. */
const at = (root: unknown, ref: string): unknown =>
  ref
    .slice(2)
    .split("/")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root);

/**
 * `schema` with every `$ref` replaced by the schema it points to (resolved in `root`), and without `$defs`.
 * A definition that refers to itself again (filter conditions) becomes `{ $cycle: name }`, named the same way
 * in the nested (`common/$defs/uuid`) and the flat (`common.uuid`) form, so both forms compare equal.
 */
const dereference = (schema: unknown, root: unknown, stack: readonly string[] = []): unknown => {
  if (Array.isArray(schema)) {
    return schema.map((item) => dereference(item, root, stack));
  }
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$defs") {
      continue;
    }
    if (key === "$ref" && typeof value === "string") {
      const name = value.replace(/^#\/\$defs\//, "").replace("/$defs/", ".");
      out[key] = stack.includes(name)
        ? { $cycle: name }
        : dereference(at(root, value), root, [...stack, name]);
      continue;
    }
    out[key] = dereference(value, root, stack);
  }
  return out;
};

describe("serverTools on the whole catalog", () => {
  it("gives for every catalog command the schema of mcp-tools.json, once all $refs are resolved", async () => {
    const file = JSON.parse(await fs.readFile(generated, "utf8")) as {
      tools: { name: string; inputSchema: unknown }[];
    };
    const contracts = loadContracts();
    // A stub for every command, so every catalog entry is listed, also those of later stages.
    const all = createCommandRuntime({
      contracts,
      commands: contracts.commands.map((entry) =>
        defineTestCommand({ name: entry.name, run: () => Promise.resolve({}) }),
      ),
    });
    const tools = serverTools(all);
    expect(tools.map((t) => t.name)).toEqual(file.tools.map((t) => t.name));
    for (const [index, tool] of tools.entries()) {
      const full = file.tools[index]?.inputSchema;
      expect([tool.name, dereference(tool.inputSchema, tool.inputSchema)]).toEqual([
        tool.name,
        dereference(full, file),
      ]);
    }
    // The recursive filter condition is among them and ends in a cycle marker on both sides.
    const list = tools.find((t) => t.command === "element.list");
    expect(JSON.stringify(dereference(list?.inputSchema, list?.inputSchema))).toContain(
      '{"$cycle":"filter.condition"}',
    );
  });
});
