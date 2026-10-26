import { describe, expect, it } from "vitest";
import { FIRST_COMMANDS, agentInstructions, schemaDescription } from "./instructions.js";
import { createCommandRuntime, getCommandRuntime } from "./invoke.js";
import { loadContracts } from "./contracts.js";

const toolName = (command: string): string => command.replace(".", "_");

describe("agentInstructions", () => {
  it("names the first commands with their catalog summaries, the IDs and how hints are confirmed", () => {
    const runtime = getCommandRuntime();
    const text = agentInstructions(runtime, toolName);
    const lines = text.split("\n");
    const first = FIRST_COMMANDS.map(
      (name) => `- ${toolName(name)}: ${runtime.contracts.entry(name)?.summary ?? "missing"}`,
    );
    const start = lines.indexOf("Start with:");
    expect(lines.slice(start + 1, start + 1 + first.length)).toEqual(first);
    expect(text).toContain(
      "- `ref`: A reference to an element as given by a person or an external tool: UUID or short ID. Any case is accepted: sr-5a8b25 names SR-5a8b25.\n",
    );
    expect(text).toContain("- `shortId`: Display ID: type prefix, dash, the trailing hex characters");
    expect(text).toContain("- `id`: Element ID: random UUID version 4, lower case, never changes.\n");
    const confirm = runtime.contracts.entry("hint.confirm")?.summary.replace(" (D-042)", "");
    expect(text).toContain(
      `- \`hintId\`: hint_list gives each confirmable hint a stable ID. hint_confirm: ${confirm ?? "missing"}\n`,
    );
    expect(text).toContain("Only element_setStatus and element_supersede change a status");
    // References to decisions and requirements mean nothing to an agent.
    expect(text).not.toMatch(/\((?:D|SR|N)-\d{3}/);
    expect(text.length).toBeLessThan(4096);
  });

  it("uses the catalog names by default and leaves out commands that are not implemented", () => {
    const empty = createCommandRuntime({ contracts: loadContracts(), commands: [] });
    const text = agentInstructions(empty);
    expect(text).not.toContain("Start with:");
    expect(text).not.toContain("hintId");
    expect(text).toContain("- `ref`: ");
    expect(agentInstructions(getCommandRuntime())).toContain("- workspace.status: ");
  });
});

describe("schemaDescription", () => {
  const schemas = loadContracts().schemas;

  it("gives a description of a schema file without references to the spec", () => {
    expect(schemaDescription(schemas, "common.schema.json", ["$defs", "uuid"])).toBe(
      "Element ID: random UUID version 4, lower case, never changes.",
    );
  });

  it("throws when there is no description at the path or no such file", () => {
    expect(() => schemaDescription(schemas, "common.schema.json", ["$defs", "nope"])).toThrow(
      "no description at common.schema.json#/$defs/nope",
    );
    expect(() => schemaDescription(schemas, "nope.schema.json", [])).toThrow(
      "no description at nope.schema.json#/",
    );
    expect(() => schemaDescription(schemas, "nope.schema.json", ["$defs", "uuid"])).toThrow(
      "no description at nope.schema.json#/$defs/uuid",
    );
  });
});
