import { describe, expect, it } from "vitest";
import { rank } from "./fuzzy.js";

const ACTIONS = [
  "Go to element or buffer",
  "Search elements",
  "List all elements",
  "Filter list by type",
  "Filter list by status",
  "Filter list by property",
  "Filter list by text search",
  "Filter list by saved filter",
  "Clear list filter",
  "Create relation",
  "Sort list",
  "Close buffer",
  "Show element ID and version",
];

const names = (query: string): string[] => rank(ACTIONS, (name) => name, query).map(({ item }) => item);

describe("rank", () => {
  it("keeps all items in the given order for an empty query", () => {
    expect(rank(ACTIONS, (name) => name, "")).toHaveLength(ACTIONS.length);
    expect(names("  ")).toEqual(ACTIONS);
    expect(rank(ACTIONS, (name) => name, "")[0]?.ranges).toEqual([]);
  });

  it("finds an abbreviation: the letters of a word in order", () => {
    expect(names("srch elem").slice(0, 3)).toContain("Search elements");
    expect(names("srch elem")[0]).toBe("Search elements");
    expect(names("clr")[0]).toBe("Clear list filter");
  });

  it("finds words that are separated by a space", () => {
    expect(names("go el")[0]).toBe("Go to element or buffer");
    expect(names("fl by ty")[0]).toBe("Filter list by type");
  });

  it("finds a word with one slip when nothing matches in order (a typo)", () => {
    expect(
      names("filtre")
        .slice(0, 3)
        .every((name) => name.startsWith("Filter")),
    ).toBe(true);
    expect(names("sotr")[0]).toBe("Sort list");
  });

  it("[SR-121/AK1] finds an action by the beginnings of its words, skipping words", () => {
    expect(names("lae")[0]).toBe("List all elements");
    expect(names("flp")).toEqual(["Filter list by property"]);
    expect(names("crel")).toEqual(["Create relation"]);
    expect(names("fls")).toEqual([
      "Filter list by status",
      "Filter list by text search",
      "Filter list by saved filter",
    ]);
    // The beginnings of words in the given order come before the other matches.
    expect(names("fil").slice(0, 3)).toEqual([
      "Filter list by type",
      "Filter list by status",
      "Filter list by property",
    ]);
    expect(rank(ACTIONS, (name) => name, "flp")[0]?.ranges).toEqual([
      [0, 1],
      [7, 8],
      [15, 16],
    ]);
  });

  it("matches the beginnings of words from the first word on, in order, and not for a single letter", () => {
    expect(names("ael")).toEqual([]);
    expect(names("lp")).toEqual([]);
    expect(names("l")).toContain("List all elements");
    expect(names("fl by")).not.toContain("Sort list");
    // "go" is the beginning of "Go", "t" of "to" and "e" of "element".
    expect(names("gote")).toEqual(["Go to element or buffer"]);
  });

  it("finds nothing for a query without a word", () => {
    expect(names("!!")).toEqual([]);
    expect(names("zzzz")).toEqual([]);
  });

  it("gives the character ranges that matched", () => {
    expect(rank(ACTIONS, (name) => name, "sort")[0]).toEqual({ item: "Sort list", ranges: [[0, 4]] });
    expect(rank(ACTIONS, (name) => name, "srch elem")[0]?.ranges).toEqual([
      [0, 1],
      [3, 6],
      [7, 11],
    ]);
  });

  it("keeps the given order among equal matches (recent first)", () => {
    expect(rank(["Buffer b", "Buffer a"], (name) => name, "buffer").map(({ item }) => item)).toEqual([
      "Buffer b",
      "Buffer a",
    ]);
  });
});
