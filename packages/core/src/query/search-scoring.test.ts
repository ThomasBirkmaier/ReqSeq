// `scoreWords` against MiniSearch's own `search` (search-scoring.ts): the same documents, the same
// scores to the bit and the same matches, key order included, for every kind of query the search
// makes. A MiniSearch version that scores otherwise fails here.
import MiniSearch from "minisearch";
import type { Query, SearchResult } from "minisearch";
import { describe, expect, it } from "vitest";
import type { SearchDocument } from "./search-index.js";
import { WORD_FIELDS, engineOptionsFor, normalizeWord, WORD_SEPARATOR } from "./search-index.js";
import type { ScoringOptions } from "./search-scoring.js";
import {
  carryLengths,
  documentKeys,
  lengthsOf,
  nextShortId,
  phraseCandidates,
  scoreDocuments,
  scoreWords,
  searchOptionsOf,
  shortIdOfDocument,
} from "./search-scoring.js";

const TEXTS = [
  ["Wind speed on the display", "The station shall show wind speed. Wind again.", "draft\nfunctional"],
  ["Wind direction in the log", "The station shall log wind direction every minute.", "approved\n2026"],
  ["Temperature at the mast", "Temperatures and temprature typos; the then there.", "draft\nv1.2 1 s"],
  ["Battery level", "Batteries: level 1, level 12, level 123. Größe GRÖSSE größe.", "Größe\nquality"],
  ["Station status", "Stations stay stationary; status stated.", "2026-10-26\n12"],
  ["", "Only text with Wind and wind and WIND.", ""],
  ["Humidity sensor", "", "humid humidity humidities"],
  ["Rainfall", "rain rainfall rainfalls rainy", "draft"],
  ["Ünïcödé", "naïve café ÇA", "1 2 3"],
  ["constructor toString", "valueOf hasOwnProperty", "prototype"],
];

/** The keys of the single properties: each line of the properties of a text is one (SR-216). */
const KEYS = ["p0", "p1", "p2"];

const documents: SearchDocument[] = TEXTS.map(([title, text, properties], i) => ({
  key: `r\0doc-${String(i)}.md`,
  title: String(title),
  text: String(text),
  parts: String(properties)
    .split("\n")
    .flatMap((line, at) => [`p${String(at)}`, line]),
}));

/** The first document (`r\0doc-0.md`). */
const firstDocument = (): SearchDocument => {
  const [first] = documents;
  if (first === undefined) {
    throw new Error("no documents");
  }
  return first;
};

const engine = (): MiniSearch<SearchDocument> => {
  const mini = new MiniSearch<SearchDocument>(engineOptionsFor(KEYS));
  mini.addAll(documents);
  return mini;
};

/** The documents in an engine of the three fields of words only, `properties` as one text: the index before single properties (SR-216). */
const plainEngine = (): MiniSearch => {
  const mini = new MiniSearch({
    idField: "key",
    fields: [...WORD_FIELDS],
    tokenize: (text: string) => text.split(WORD_SEPARATOR),
    processTerm: normalizeWord,
  });
  mini.addAll(
    TEXTS.map(([title, text, properties], i) => ({ key: `r\0doc-${String(i)}.md`, title, text, properties })),
  );
  return mini;
};

const options = (overrides: Partial<ScoringOptions> = {}): ScoringOptions => ({
  fields: ["title", "text", "properties"],
  boost: { title: 2, text: 1, properties: 1 },
  fuzzy: (term) => term.length >= 4 && !/\p{N}/u.test(term) && 0.2,
  prefix: (term) => term.length >= 2,
  ...overrides,
});

/** What MiniSearch gives for `words` combined with `AND`, by document key. */
const expected = (
  mini: MiniSearch,
  words: readonly string[],
  scoring: ScoringOptions,
): Map<string, SearchResult> => {
  const query: Query = {
    queries: words.map((word) => ({ queries: [word], combineWith: "AND" })),
    combineWith: "AND",
  };
  return new Map(mini.search(query, searchOptionsOf(scoring)).map((result) => [String(result.id), result]));
};

/** What `scoreWords` gives, in the same form. */
const actual = (mini: MiniSearch, words: readonly string[], scoring: ScoringOptions, generation = 0) => {
  const scored = scoreWords(mini, generation, words, scoring);
  const keys = documentKeys(mini);
  return new Map(
    scored.docs.map((doc, i) => [
      String(keys.get(doc)),
      { score: scored.scores[i], match: scored.matchOf(doc) },
    ]),
  );
};

const same = (mini: MiniSearch, words: readonly string[], scoring = options()): number => {
  const want = expected(mini, words, scoring);
  const got = actual(mini, words, scoring);
  expect([...got.keys()].sort(), JSON.stringify(words)).toEqual([...want.keys()].sort());
  for (const [key, result] of want) {
    const mine = got.get(key);
    // Bit for bit, and the words in MiniSearch's order with their fields.
    expect(Object.is(mine?.score, result.score), `${JSON.stringify(words)} ${key}`).toBe(true);
    expect(JSON.stringify(mine?.match), `${JSON.stringify(words)} ${key}`).toBe(JSON.stringify(result.match));
  }
  return want.size;
};

const QUERIES: readonly (readonly string[])[] = [
  ["wind"],
  ["WIND"],
  ["wi"],
  ["w"],
  ["st"],
  ["sta"],
  ["station"],
  ["stationary"],
  ["the"],
  ["th"],
  ["temperatur"],
  ["temprature"],
  ["HUMIDTY"],
  ["humidities"],
  ["rainfal"],
  ["wind", "speed"],
  ["wind", "wind"],
  ["wind", "direction", "log"],
  ["the", "station", "shall"],
  ["v1.2"],
  ["v1.2", "draft"],
  ["1"],
  ["12"],
  ["2026"],
  ["2026-10-26"],
  ["größe"],
  ["GRÖSSE"],
  ["grosse"],
  ["Ünïcödé"],
  ["cafe"],
  ["constructor"],
  ["prototype"],
  ["valueof", "tostring"],
  ["level", "1"],
  ["nowhere"],
  ["wind", "nowhere"],
  ["!!"],
  ["wind", "!!"],
  ["!!", "wind"],
  [],
];

describe("scoreWords", () => {
  it("finds, scores and matches as MiniSearch's search does, for every kind of query", () => {
    const mini = engine();
    let found = 0;
    for (const words of QUERIES) {
      found += same(mini, words);
    }
    expect(found).toBeGreaterThan(50);
  });

  it("does so in some fields, without prefix or fuzzy matches, and with an edit distance", () => {
    const mini = engine();
    for (const words of QUERIES) {
      same(mini, words, options({ fields: ["title"] }));
      same(mini, words, options({ fields: ["text", "properties"], boost: { text: 3, properties: 1 } }));
      same(mini, words, options({ prefix: () => false }));
      same(mini, words, options({ fuzzy: () => false, prefix: () => false }));
      same(mini, words, options({ fuzzy: () => 0 }));
      same(mini, words, options({ fuzzy: () => 2 }));
      same(mini, words, options({ fuzzy: () => 0.4 }));
      // Exactly 1 is an edit distance, not a share of the length; a share rounds and is capped at 6.
      same(mini, words, options({ fuzzy: () => 1 }));
      same(mini, words, options({ fuzzy: () => 0.9 }));
    }
    expect(same(mini, ["temprature"], options({ fuzzy: () => 2 }))).toBeGreaterThan(0);
    expect(same(mini, ["temprature"], options({ fuzzy: () => 1 }))).toBeGreaterThan(0);
    expect(same(mini, ["humidities"], options({ fuzzy: () => 0.9 }))).toBeGreaterThan(0);
  });

  it("does so in fields of single properties, alone and with fixed fields (SR-216)", () => {
    const mini = engine();
    let found = 0;
    for (const words of QUERIES) {
      found += same(mini, words, options({ fields: ["property:p0"], boost: { "property:p0": 1 } }));
      same(
        mini,
        words,
        options({
          fields: ["title", "property:p1", "property:p2"],
          boost: { title: 2, "property:p1": 1, "property:p2": 1 },
        }),
      );
    }
    expect(found).toBeGreaterThan(5);
  });

  it("[SR-216/AK-hpd4] scores a search in every field as an index without fields of single properties, to the bit", () => {
    const mini = engine();
    const plain = plainEngine();
    let found = 0;
    for (const words of QUERIES) {
      const want = actual(plain, words, options());
      const got = actual(mini, words, options());
      expect(
        [...got.entries()].map(([key, { score, match }]) => [key, score, JSON.stringify(match)]),
      ).toEqual([...want.entries()].map(([key, { score, match }]) => [key, score, JSON.stringify(match)]));
      found += got.size;
    }
    expect(found).toBeGreaterThan(50);
  });

  it("scores a carried MiniSearch object as it is after the change (`generation`)", () => {
    const mini = engine();
    const scoring = options();
    expect(actual(mini, ["zanzibar"], scoring, 0).size).toBe(0);
    mini.remove(firstDocument());
    mini.add({ key: "r\0new.md", title: "Zanzibar wind", text: "wind wind", parts: [] });
    expect(nextShortId(mini)).toBe(documents.length + 1);
    // Another generation: field lengths and documents are read again.
    expect([...actual(mini, ["zanzibar"], scoring, 1).keys()]).toEqual(["r\0new.md"]);
    for (const words of QUERIES) {
      expect(actual(mini, words, scoring, 1).size).toBe(expected(mini, words, scoring).size);
    }
    same(mini, ["wind"]);
  });
});

describe("late documents (SR-068 AK5)", () => {
  /** Documents with type and status names in `properties` and again in the fields `type` and `status`. */
  const named = (): MiniSearch<SearchDocument> => {
    const mini = new MiniSearch<SearchDocument>(engineOptionsFor(KEYS));
    const document = (key: string, title: string, parts: string[]): SearchDocument => ({
      key,
      title,
      text: "",
      parts,
    });
    mini.addAll([
      document("only-names", "Sensors", ["type", "Package", "status", "In review"]),
      document("in-title", "Package tools", ["type", "Package", "status", "Draft"]),
      document("in-value", "Readings", ["p0", "a package", "type", "Package", "status", "Draft"]),
      document("typo", "Pakage list", ["type", "Package", "status", "Draft"]),
      document("two-names", "Gauges", ["type", "Review", "status", "In review"]),
    ]);
    return mini;
  };

  /** The keys of the documents `words` finds, each with " late" when it is late. */
  const lateOf = (mini: MiniSearch, words: string[], scoring: ScoringOptions): string[] => {
    const scored = scoreWords(mini, 0, words, scoring);
    const keys = documentKeys(mini);
    return scored.docs.map((doc) => `${String(keys.get(doc))}${scored.late(doc) ? " late" : ""}`).sort();
  };

  const NAMED = { in: "properties", fields: ["type", "status"] };

  it("[SR-068/AK-rbwp] marks a document late when a term found it only through the named fields, scores unchanged", () => {
    const mini = named();
    const scoring = options({ named: NAMED });
    expect(lateOf(mini, ["package"], scoring)).toEqual(["in-title", "in-value", "only-names late", "typo"]);
    // Every term of a word: "in" is in a value of in-value only, "review" in a status name.
    expect(lateOf(mini, ["sensors", "in-review"], scoring)).toEqual(["only-names late"]);
    // The type and the status name together, and no more often in `properties`: only through them.
    expect(lateOf(mini, ["review"], scoring)).toEqual(["only-names late", "two-names late"]);
    // Without `named`, or with fields the index does not have, or `properties` not searched: none.
    expect(lateOf(mini, ["package"], options())).not.toContain("only-names late");
    expect(lateOf(mini, ["package"], options({ named: { in: "nowhere", fields: ["none"] } }))).not.toContain(
      "only-names late",
    );
    expect(lateOf(mini, ["package"], options({ named: NAMED, fields: ["title"] }))).toEqual([
      "in-title",
      "typo",
    ]);
    for (const words of [["package"], ["review"], ["sensors", "in-review"], ["pakage"]]) {
      same(mini, words, scoring);
    }
  });
});

describe("carryLengths", () => {
  it("leaves an added short ID MiniSearch holds no lengths of at zero, as a fresh build does", () => {
    const mini = engine();
    lengthsOf(mini, 0);
    mini.add({ key: "r\0kept.md", title: "Kept", text: "kept words", parts: [] });
    mini.add({ key: "r\0gone.md", title: "Gone", text: "gone again", parts: [] });
    const gone = Number(shortIdOfDocument(mini, "r\0gone.md"));
    mini.discard("r\0gone.md");
    carryLengths(mini, 1, [], [gone - 1, gone]);
    const carried = lengthsOf(mini, 1);
    // Another generation: built from MiniSearch's lengths in full.
    expect(carried.lengths).toEqual(lengthsOf(mini, 2).lengths);
    const { fields } = carried;
    const of = (doc: number): number[] => [...carried.lengths.subarray(doc * fields, (doc + 1) * fields)];
    expect(of(gone).every((n) => n === 0)).toBe(true);
    expect(of(gone - 1).some((n) => n > 0)).toBe(true);
  });
});

describe("phraseCandidates", () => {
  it("finds the documents that hold every word of a phrase in a field, the last one as a word start when open", () => {
    const mini = engine();
    const keys = documentKeys(mini);
    const of = (words: string[], prefix: boolean, field: string): unknown[] =>
      phraseCandidates(mini, { words, prefix }, field).map((doc) => keys.get(doc));
    expect(of(["the", "station"], false, "text")).toEqual(["r\0doc-0.md", "r\0doc-1.md"]);
    expect(of(["the", "s"], true, "text")).toEqual(["r\0doc-0.md", "r\0doc-1.md"]);
    expect(of(["the", "s"], false, "text")).toEqual([]);
    // One word, open: every document with a word it begins.
    expect(of(["stat"], true, "text").sort()).toEqual(["r\0doc-0.md", "r\0doc-1.md", "r\0doc-4.md"]);
    expect(of(["zz"], true, "text")).toEqual([]);
  });
});

describe("scoreDocuments", () => {
  it("scores some documents as scoreWords does, to the bit, a few on their own and many through scoreWords", () => {
    const mini = engine();
    for (const words of QUERIES) {
      for (const scoring of [
        options(),
        options({ fields: ["text"], boost: { text: 1 }, fuzzy: () => false, prefix: () => false }),
      ]) {
        const scored = scoreWords(mini, 0, words, scoring);
        // Every document found, and each one alone (few against the documents of the words).
        for (const docs of [scored.docs, ...scored.docs.map((doc) => [doc])]) {
          const scores = scoreDocuments(mini, 0, words, scoring, docs);
          docs.forEach((doc, at) => {
            const want = scored.scores[scored.docs.indexOf(doc)];
            expect(Object.is(scores[at], want), `${JSON.stringify(words)} ${String(doc)}`).toBe(true);
          });
        }
      }
    }
    // A document that does not hold a word scores what the words it holds add up to.
    const [only] = scoreDocuments(mini, 0, ["wind", "nowhere"], options(), [0]);
    const [wind] = scoreDocuments(mini, 0, ["wind"], options(), [0]);
    expect(only).toBeCloseTo(Number(wind) * 2);
  });
});
