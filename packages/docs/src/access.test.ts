import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { commandAccess } from "./access.js";

describe("commandAccess", () => {
  it("fails when the generated contracts lack the command", async () => {
    const runtime = getCommandRuntime();
    const entry = runtime.contracts.commands[0];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const empty = { openapi: { paths: {} }, mcpTools: { tools: [] } };
    await expect(commandAccess(entry, runtime, empty)).rejects.toThrow(/missing in the generated contracts/);
    const apiOnly = {
      openapi: { paths: { [`/v1/commands/${entry.name}`]: { post: {} } } },
      mcpTools: { tools: [] },
    };
    await expect(commandAccess(entry, runtime, apiOnly)).rejects.toThrow(/run pnpm contracts:generate/);
  });
});
