// The words of a MiniSearch object for word parts (SR-221 AK1, `search-vocabulary.ts`): walked,
// carried over changes, and scanned.
import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import { normalizeWord } from "./phrase-text.js";
import { documentKeys, scoreDocuments, scoreWords } from "./search-scoring.js";
import { buildVocabulary, carryVocabulary, newWords, partWords, vocabularyOf } from "./search-vocabulary.js";

interface Doc {
  readonly id: string;
  readonly text: string;
  readonly n?: number;
}

const engine = (docs: readonly Doc[]): MiniSearch<Doc> => {
  const mini = new MiniSearch<Doc>({
    fields: ["text", "n"],
    processTerm: normalizeWord,
    autoVacuum: false,
  });
  mini.addAll(docs);
  return mini;
};

const words = (text: string): string[] =>
  text
    .split("\0")
    .filter((word) => word !== "")
    .sort();

describe("vocabulary of word parts (SR-221)", () => {
  it("[SR-221/AK-jq93] finds the words that hold a term after their start, each word start left out", () => {
    const text = vocabularyOf(
      engine([{ id: "a", text: "Seite Paketseite Seiteseite Referenzseiten bau" }]),
      0,
    );
    expect(words(text)).toEqual(["bau", "paketseite", "referenzseiten", "seite", "seiteseite"]);
    expect(partWords(text, "seite").sort()).toEqual(["paketseite", "referenzseiten"]);
    expect(partWords(text, "nichts")).toEqual([]);
    expect(partWords("\0", "seite")).toEqual([]);
  });

  it("is walked in slices with a pause between them, and kept per change", async () => {
    const mini = engine(
      Array.from({ length: 3000 }, (_, n) => ({ id: String(n), text: `wort${String(n)}x` })),
    );
    let pauses = 0;
    await buildVocabulary(mini, 0, 0, () => {
      pauses += 1;
      return Promise.resolve();
    });
    expect(pauses).toBe(1);
    const text = vocabularyOf(mini, 0);
    expect(vocabularyOf(mini, 0)).toBe(text);
    expect(words(text)).toHaveLength(3000);
    // Within its slice it never pauses.
    let none = 0;
    await buildVocabulary(mini, 0, 60_000, () => {
      none += 1;
      return Promise.resolve();
    });
    expect(none).toBe(0);
  });

  it("is carried: new words appended, a word that leaves stays and comes back twice; walked again when it outgrew", () => {
    const mini = engine([{ id: "a", text: "Paketseite Anfang Bericht Ende Station Wetter" }]);
    const first = vocabularyOf(mini, 0);
    // Only text fields are read; a word the tree holds is no new word.
    const added = [{ id: "b", text: "Paketseite Hauptseite", n: 7 }];
    expect(newWords(mini, added)).toEqual(["hauptseite"]);
    mini.addAll(added);
    expect(carryVocabulary(mini, 1, ["hauptseite"])).toBe(true);
    expect(partWords(vocabularyOf(mini, 1), "seite")).toEqual(["paketseite", "hauptseite"]);
    expect(vocabularyOf(mini, 1).startsWith(first)).toBe(true);
    // Removed and back: the word is in the string twice, the caller takes it once.
    mini.remove(added[0] as Doc);
    expect(partWords(vocabularyOf(mini, 1), "seite")).toContain("hauptseite");
    expect(carryVocabulary(mini, 2, [])).toBe(true);
    const scoring = {
      fields: ["text"],
      boost: { text: 1 },
      fuzzy: () => false as const,
      prefix: () => true,
      parts: () => true,
    };
    // A stale word (gone from the tree) finds nothing.
    expect(scoreWords(mini, 2, ["seite"], scoring).docs.map((doc) => documentKeys(mini).get(doc))).toEqual([
      "a",
    ]);
    mini.add({ id: "c", text: "Hauptseite" });
    expect(carryVocabulary(mini, 3, ["hauptseite"])).toBe(true);
    expect(partWords(vocabularyOf(mini, 3), "seite")).toEqual(["paketseite", "hauptseite", "hauptseite"]);
    // Scored once, as the word it is.
    const once = scoreWords(mini, 3, ["seite"], scoring);
    expect(once.docs.map((doc) => documentKeys(mini).get(doc))).toEqual(["a", "c"]);
    expect([...once.partsOf(Number(once.docs[1])).entries()]).toEqual([["hauptseite", ["seite"]]]);
    // The places of a phrase score its words in part as `scoreWords` does.
    expect([...scoreDocuments(mini, 3, ["seite"], scoring, [...once.docs])]).toEqual([...once.scores]);
    // Appended words longer than the walked ones: none carried, walked again on use.
    expect(carryVocabulary(mini, 4, ["x".repeat(first.length)])).toBe(false);
    expect(words(vocabularyOf(mini, 4))).toEqual([
      "anfang",
      "bericht",
      "ende",
      "hauptseite",
      "paketseite",
      "station",
      "wetter",
    ]);
    // No vocabulary of the change before: none carried.
    expect(carryVocabulary(mini, 9, ["neu"])).toBe(false);
    expect(carryVocabulary(engine([]), 1, ["neu"])).toBe(false);
  });
});
