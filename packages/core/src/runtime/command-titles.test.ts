import { describe, expect, it } from "vitest";
import { commandTitle } from "./command-titles.js";

describe("commandTitle", () => {
  it("names a command by its title in quotes", () => {
    expect(commandTitle("hint.list")).toBe('"List hints"');
  });

  it("falls back to the name of a command the catalog does not have", () => {
    expect(commandTitle("test.none")).toBe('"test.none"');
  });
});
