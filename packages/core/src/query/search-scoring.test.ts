// `scoreWords` against MiniSearch's own `search` (search-scoring.ts): the same documents, the same
// scores to the bit and the same matches, key order included, for every kind of query the search
// makes. A MiniSearch version that scores otherwise fails here.
import MiniSearch from "minisearch";
import type { Query, SearchResult } from "minisearch";
import { describe, expect, it, vi } from "vitest";
import type { SearchDocument } from "./search-index.js";
import { ENGINE_OPTIONS } from "./search-index.js";
import type { ScoringOptions } from "./search-scoring.js";
import { documentKeys, nextShortId, scoreWords, searchOptionsOf } from "./search-scoring.js";

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

const documents: SearchDocument[] = TEXTS.map(([title, text, properties], i) => ({
  key: `r\0doc-${String(i)}.md`,
  title: String(title),
  text: String(text),
  properties: String(properties),
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
  const mini = new MiniSearch<SearchDocument>(ENGINE_OPTIONS);
  mini.addAll(documents);
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
  if (scored === undefined) {
    return undefined;
  }
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
  expect(got, JSON.stringify(words)).toBeDefined();
  expect([...(got?.keys() ?? [])].sort(), JSON.stringify(words)).toEqual([...want.keys()].sort());
  for (const [key, result] of want) {
    const mine = got?.get(key);
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
    }
    expect(same(mini, ["temprature"], options({ fuzzy: () => 2 }))).toBeGreaterThan(0);
  });

  it("scores a carried MiniSearch object as it is after the change (`generation`)", () => {
    const mini = engine();
    const scoring = options();
    expect(actual(mini, ["zanzibar"], scoring, 0)?.size).toBe(0);
    mini.remove(firstDocument());
    mini.add({ key: "r\0new.md", title: "Zanzibar wind", text: "wind wind", properties: "" });
    expect(nextShortId(mini)).toBe(documents.length + 1);
    // Another generation: field lengths and documents are read again.
    expect([...(actual(mini, ["zanzibar"], scoring, 1)?.keys() ?? [])]).toEqual(["r\0new.md"]);
    for (const words of QUERIES) {
      expect(actual(mini, words, scoring, 1)?.size).toBe(expected(mini, words, scoring).size);
    }
    same(mini, ["wind"]);
  });

  it("leaves to MiniSearch an index with discarded documents or with words of a document that is none", () => {
    const discarded = engine();
    discarded.discard("r\0doc-0.md");
    expect(scoreWords(discarded, 0, ["wind"], options())).toBeUndefined();
    // A document removed with other texts than it was added with leaves its old words in the index
    // (MiniSearch warns); MiniSearch drops them as a search meets them, so it searches itself.
    const stale = engine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stale.remove({ ...firstDocument(), text: "", properties: "" });
    warn.mockRestore();
    expect(stale.dirtCount).toBe(0);
    expect(scoreWords(stale, 1, ["wind"], options())).toBeUndefined();
    expect(scoreWords(stale, 1, ["humidity"], options())).toBeDefined();
  });
});
