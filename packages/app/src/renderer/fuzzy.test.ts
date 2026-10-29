import { describe, expect, it } from "vitest";
import { IN_ORDER, ONE_SLIP, matchingNames, rank } from "./fuzzy.js";

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

const matching = (items: readonly string[], query: string): string[] =>
  rank(items, (name) => name, query).map(({ item }) => item);

const names = (query: string): string[] => matching(ACTIONS, query);

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

  it("[SR-108/AK1] finds the command among the first three for its initials or with a typo", () => {
    // The names are the ones of the command prompt, with "Create relation" of the catalog commands.
    const first = (query: string): string[] => names(query).slice(0, 3);
    expect(first("crel")).toContain("Create relation");
    expect(names("crel")[0]).toBe("Create relation");
    expect(first("lae")).toContain("List all elements");
    for (const [typed, meant] of [
      ["craete relation", "Create relation"],
      ["create relaton", "Create relation"],
      ["craete relaton", "Create relation"],
      ["lsit all elements", "List all elements"],
      ["sotr", "Sort list"],
      ["clse buffer", "Close buffer"],
      ["serach elements", "Search elements"],
      ["shwo element id and version", "Show element ID and version"],
    ] as const) {
      expect(first(typed)).toContain(meant);
    }
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

  // #304: one key of a typed Windows path took half a minute in the regular expression of all terms.
  it("answers a long path of many words that matches nothing at once", () => {
    const station = String.raw`C:\Users\runneradmin\AppData\Local\Temp\reqseq-app-fixture-AbC123\kestrel`;
    const typed = String.raw`C:\Users\runneradmin\AppData\Local\Temp\reqseq-app-fixture-XyZ789\quokka\requirements`;
    const started = performance.now();
    for (let length = 1; length <= typed.length; length += 1) {
      rank([station], (name) => name, typed.slice(0, length));
    }
    expect(rank([station], (name) => name, typed)).toEqual([]);
    expect(rank(["a b c d e f g h i j ".repeat(20)], (name) => name, "a b c d e f g h q")).toEqual([]);
    expect(rank(["a ".repeat(40)], (name) => name, `${"a".repeat(25)}b`)).toEqual([]);
    // Generous for a slow machine; each took seconds to minutes before.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("finds the terms in order where the first place of a term leaves no room for the next", () => {
    // "temp" first matches in "temporal", which leaves no "kestrel" after it; the match is the later one.
    expect(matching(["temporal kestrel temp"], "kestrel temp")).toEqual(["temporal kestrel temp"]);
    expect(matching(["temp kestrel"], "kestrel temp")).toEqual([]);
    expect(matching(["Users runneradmin kestrel"], "users kestrl")).toEqual(["Users runneradmin kestrel"]);
    expect(matching(["Users runneradmin kestrel"], "kestrl users")).toEqual([]);
  });

  it("finds no match across a line break, as uFuzzy's regular expression does not", () => {
    expect(matching(["alpha\nbeta"], "alp bet")).toEqual([]);
    expect(matching(["Open\u2028workspace"], "open work")).toEqual([]);
    expect(matching(["first\r\nOpen workspace"], "open work")).toEqual(["first\r\nOpen workspace"]);
  });

  // A seeded generator, so a failure repeats: the pre-check gives exactly what uFuzzy's `filter` gives.
  it("finds the same names as uFuzzy's regular expression of the whole needle, for both matchers", () => {
    let seed = 304;
    const random = (below: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };
    const text = (alphabet: string, length: number): string =>
      Array.from({ length: random(length) + 1 }, () => alphabet.charAt(random(alphabet.length))).join("");
    const NAME = "abcdeABE  '\"-_.\\/:é1\n\r\u2028";
    const QUERY = "abcdeAE  '-é1";
    for (const matcher of [IN_ORDER, ONE_SLIP]) {
      for (let round = 0; round < 300; round += 1) {
        const list = Array.from({ length: 8 }, () => text(NAME, 24));
        const needle = text(QUERY, 12);
        const terms = matcher.split(needle);
        if (terms.length > 0) {
          expect(matchingNames(matcher, list, terms), JSON.stringify([list, needle])).toEqual(
            matcher.filter(list, needle),
          );
        }
      }
    }
  });

  it("finds nothing for a term without an expression", () => {
    expect(matchingNames(IN_ORDER, ["a b"], ["", "a"])).toEqual([]);
  });

  it("keeps the given order among equal matches (recent first)", () => {
    expect(rank(["Buffer b", "Buffer a"], (name) => name, "buffer").map(({ item }) => item)).toEqual([
      "Buffer b",
      "Buffer a",
    ]);
  });
});
