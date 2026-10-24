import { describe, expect, it } from "vitest";
import { CommandError, defineCommand } from "./catalog.js";

describe("command catalog", () => {
  it("returns the definition unchanged", () => {
    const def = {
      name: "test.echo",
      summary: "Echo",
      effect: "read" as const,
      implements: [],
      input: {},
      output: {},
      run: (_ctx: unknown, input: string) => Promise.resolve(input),
    };
    expect(defineCommand(def)).toBe(def);
  });

  it("carries the problem code in CommandError", () => {
    const err = new CommandError("E_TEST", "failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CommandError");
    expect(err.code).toBe("E_TEST");
    expect(err.message).toBe("failed");
  });
});
