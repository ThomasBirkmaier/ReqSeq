import { describe, expect, it } from "vitest";
import { nth } from "./lists.js";

describe("nth", () => {
  it("gives the item at an index, and fails for an index with none", () => {
    expect(nth(["a", "b"], 1)).toBe("b");
    expect(() => nth(["a"], 3)).toThrow("There is no item at 3");
    expect(() => nth([], undefined as unknown as number)).toThrow(RangeError);
  });
});
