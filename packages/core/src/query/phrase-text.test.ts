// The phrases of a search (phrase-text.ts, SR-068 AK4): the query, the units of a text and matching,
// on their own; element.search with phrases is in search-phrase.test.ts.
import { describe, expect, it } from "vitest";
import type { SearchPhrase } from "./phrase-text.js";
import { findPhrase, parseQuery, phraseUnits } from "./phrase-text.js";

/** The texts of the units of `markdown`. */
const units = (markdown: string): string[] => {
  const found = phraseUnits(markdown);
  const out: string[] = [];
  for (let at = 0; at < found.length; at += 2) {
    out.push(markdown.slice(Number(found[at]), Number(found[at + 1])));
  }
  return out;
};

const phrase = (text: string, prefix = false): SearchPhrase => ({
  words: parseQuery(`"${text}"`).phrases[0]?.words ?? [],
  prefix,
});

/** The text of the first place of `words` in `text` from `from` on, by units when `markdown`. */
const placeOf = (text: string, words: SearchPhrase, markdown = false, from = 0): string | undefined => {
  const place = findPhrase(text, words, markdown, from);
  return place === undefined ? undefined : text.slice(place.start, place.end);
};

describe("parseQuery", () => {
  it("splits the words outside quotes at white space and takes the phrases with their words", () => {
    expect(parseQuery('wind "Filter list" speed')).toEqual({
      words: ["wind", "speed"],
      phrases: [{ content: "Filter list", words: ["filter", "list"], open: false }],
    });
    expect(parseQuery("„Größe-der Anzeige“\t”a”")).toEqual({
      words: [],
      phrases: [
        { content: "Größe-der Anzeige", words: ["größe", "der", "anzeige"], open: false },
        { content: "a", words: ["a"], open: false },
      ],
    });
    // Only at the start or after white space; after a closing quote the query goes on outside.
    expect(parseQuery('x"a b" "c"d')).toEqual({
      words: ['x"a', 'b"', "d"],
      phrases: [{ content: "c", words: ["c"], open: false }],
    });
    // Without a closing quote the phrase is open; without a word it has none.
    expect(parseQuery('"" "filter li')).toEqual({
      words: [],
      phrases: [
        { content: "", words: [], open: false },
        { content: "filter li", words: ["filter", "li"], open: true },
      ],
    });
    expect(parseQuery('"')).toEqual({ words: [], phrases: [{ content: "", words: [], open: true }] });
    expect(parseQuery("")).toEqual({ words: [], phrases: [] });
  });
});

describe("phraseUnits", () => {
  it("gives paragraphs with their line breaks, list items without markers, headings, table cells and code lines", () => {
    const text = [
      "One **two**",
      "three.",
      "",
      "- item a",
      "  goes on",
      "10) item b",
      "",
      "> quoted",
      "> on",
      "",
      "# Head",
      "body",
      "Setext",
      "---",
      "after",
      "* * *",
      "",
      "| a | b \\| c |",
      "|---|---|",
      "| d | e |",
      "",
      "~~~ info",
      "code line",
      "",
      "more code",
      "~~~",
    ].join("\r\n");
    expect(units(text)).toEqual([
      "One **two**\r\nthree.",
      "item a\r\n  goes on",
      "item b",
      "quoted\r\n> on",
      "# Head",
      "body\r\nSetext",
      "after",
      "",
      " a ",
      " b \\| c ",
      "",
      "",
      " d ",
      " e ",
      "",
      "code line",
      "",
      "more code",
    ]);
    // A table or a deeper block quote inside a block; fewer markers continue the paragraph (lazy).
    expect(units("Intro\n| a | b |\n| - | - |\n| c | d |")).toEqual([
      "Intro",
      "",
      " a ",
      " b ",
      "",
      "",
      " c ",
      " d ",
      "",
    ]);
    expect(units("Intro\n> quoted\n> > deeper\nlazy")).toEqual(["Intro", "quoted", "deeper\nlazy"]);
    expect(units("plain\rline")).toEqual(["plain\rline"]);
    expect(units("")).toEqual([]);
  });
});

describe("findPhrase", () => {
  it("finds the words one after the other as whole words, in any case, with non-letters between them", () => {
    const text = "Filterlist, a FILTER—list and the filter list.";
    expect(placeOf(text, phrase("filter list"))).toBe("FILTER—list");
    expect(placeOf(text, phrase("filter list"), false, 20)).toBe("filter list");
    expect(placeOf(text, phrase("filter lis"))).toBeUndefined();
    expect(placeOf(text, phrase("filter lis", true))).toBe("FILTER—list");
    expect(placeOf(text, phrase("list and the"))).toBe("list and the");
    expect(placeOf(text, phrase("list, a"))).toBeUndefined();
    expect(placeOf(text, phrase("filte", true))).toBe("Filterlist");
    expect(placeOf(text, phrase("größe"))).toBeUndefined();
    expect(placeOf(text, { words: [], prefix: false })).toBeUndefined();
  });

  it("compares a text with other than ASCII characters word by word, in Unicode normal form", () => {
    // NFD: "Größe" with a combining diaeresis.
    const text = "Die Größe der Anzeige, die größe Anzeige.";
    expect(placeOf(text, phrase("größe der"))).toBe("Größe der");
    expect(placeOf(text, phrase("größe anzeige"))).toBe("größe Anzeige");
    expect(placeOf(text, phrase("anzeige die größe"))).toBe("Anzeige, die größe");
    expect(placeOf(text, phrase("der anz", true))).toBe("der Anzeige");
    expect(placeOf(text, phrase("der anz"))).toBeUndefined();
    expect(placeOf(text, phrase("die"), false, 20)).toBe("die");
  });

  it("compares the characters that case folding takes for ASCII letters as the index does", () => {
    // "ſ" (long s) is a word of its own for the index, the Kelvin sign is a "K" in NFC.
    expect(placeOf("A ſtorm wind, a storm wind.", phrase("storm wind"))).toBe("storm wind");
    expect(placeOf("A ſtorm wind.", phrase("storm wind"))).toBeUndefined();
    expect(placeOf("In \u212Anots now", phrase("knots now"))).toBe("\u212Anots now");
    expect(placeOf("In knots now\u0301", phrase("knots no", true))).toBe("knots now\u0301");
    expect(placeOf("In knots no\u0301w", phrase("knots no", true))).toBeUndefined();
    // "İ" is "i̇" in lower case, a word that begins with "i".
    expect(placeOf("Near the \u0130zmir port", phrase("the i", true))).toBe("the \u0130zmir");
    expect(placeOf("Near the \u0130zmir port", phrase("the izmir"))).toBeUndefined();
  });

  it("finds a place inside one unit only, and looks on after one that spans two", () => {
    const text = "A filter\n\nlist, then a filter\nlist.\n\n- filter\n- list";
    expect(placeOf(text, phrase("filter list"), true)).toBe("filter\nlist");
    expect(findPhrase(text, phrase("filter list"), true)?.start).toBe(23);
    expect(placeOf("- filter\n- list", phrase("filter list"), true)).toBeUndefined();
    expect(placeOf("Größe\n\nder", phrase("größe der"), true)).toBeUndefined();
    // Without units the whole text is one.
    expect(placeOf("- filter\n- list", phrase("filter list"))).toBe("filter\n- list");
  });
});
