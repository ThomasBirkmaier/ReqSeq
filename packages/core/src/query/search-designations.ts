// The other designations of an element (SR-220, D-059): a search for one designation of an element
// (its title, a synonym or its translation) also finds the elements in which one of its other
// designations stands. Pure: the table of a store and metamodel, and the runs of a query that are
// designations; `search-index.ts` searches them.
//
// - The table (`designationTable`): the properties with the meanings `synonyms` and `translation`
//   whose values are designations (`designationKindProblem`: kind text; a `synonyms` property
//   without `many` still gives its value). None: no table, and the search is that of SR-068 (AK5).
//   Every element of the store counts, whatever the selection or the fields searched (AK1), except
//   one whose status the metamodel marks invalid (D-044, AK4); only an element with a synonym or a
//   translation adds designations, its title among them. Each designation is its words
//   (`wordsOf`, as the index splits and compares them); a value without a letter or digit is none. A
//   translation may hold several values, and a Markdown one counts by its visible words
//   (`visibleText`): assumption of open question #1811. The designations of a key (its words joined
//   by a space) are those of every element that has it (AK1: a designation of several elements
//   counts for all of them), without the key itself; also of elements the workspace keeps apart
//   (a relation such as `distinct-from` is not read): assumption of open question #1814, option 1.
//   Built from the records of a store, so every save and watcher batch, which give a new store,
//   gives a new table (AK4).
// - The runs (`designationRuns`): in each stretch of the query between phrases, left to right, the
//   longest run of whole words that is a key of the table at that place (AK1); an overlapping
//   shorter or later one does not count (`a b c d` with the keys `a b` and `b c d` takes `a b`:
//   assumption of open question #1817). A word without a letter or digit is skipped, as the search
//   leaves it out.
// - The other designations of a run are matched as an open phrase (`SearchPhrase`, `prefix`): whole
//   words in this order, without a typo, in any case, the last word also as a word start (AK1).
import type { Metamodel, PropertyMeaning } from "../metamodel/index.js";
import { designationKindProblem, markdownKeysOf, propertyWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { invalidStatuses, titleKeyOf } from "../model/index.js";
import type { SearchPhrase } from "./phrase-text.js";
import { visibleText, wordsOf } from "./phrase-text.js";

/** The other designations of each designation (see the file comment). */
export interface DesignationTable {
  /** Per key (the words of a designation joined by a space) its other designations, each one phrase. */
  readonly others: ReadonlyMap<string, readonly SearchPhrase[]>;
  /** The most words of a key. */
  readonly longest: number;
}

const MEANINGS: readonly PropertyMeaning[] = ["synonyms", "translation"];

/** The keys of the properties whose values are designations (see the file comment). */
const designationKeys = (metamodel: Metamodel): string[] =>
  MEANINGS.flatMap((meaning) => {
    const property = propertyWithMeaning(metamodel, meaning);
    return property !== undefined && designationKindProblem(property) === undefined ? [property.key] : [];
  });

/** The texts of a value of a text property: a text or a number, also in a list. */
const textsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(textsOf)
    : typeof value === "string" || typeof value === "number"
      ? [String(value)]
      : [];

/** What reading the designations of one record needs, looked up once per table. */
interface Reading {
  readonly keys: readonly string[];
  readonly titleKey: string | undefined;
  readonly markdown: ReadonlySet<string>;
  /** One phrase per key, shared by the whole table. */
  readonly phrases: Map<string, SearchPhrase>;
}

/** The phrase of the words `words` (one per key in `reading`). */
const phraseOf = (reading: Reading, words: readonly string[]): SearchPhrase => {
  const key = words.join(" ");
  let phrase = reading.phrases.get(key);
  if (phrase === undefined) {
    phrase = { words, prefix: true };
    reading.phrases.set(key, phrase);
  }
  return phrase;
};

/**
 * The designations of `record`: its title, synonyms and translations, each once; none when it has no
 * synonym and no translation.
 */
const ownDesignations = (reading: Reading, record: ElementRecord): Set<SearchPhrase> => {
  const own = new Set<SearchPhrase>();
  const add = (text: string): void => {
    const words = wordsOf(text);
    if (words.length > 0) {
      own.add(phraseOf(reading, words));
    }
  };
  for (const key of reading.keys) {
    const markdown = reading.markdown.has(key);
    for (const text of textsOf(record.data[key])) {
      add(markdown ? visibleText(text) : text);
    }
  }
  const title = reading.titleKey === undefined ? undefined : record.data[reading.titleKey];
  if (own.size > 0 && typeof title === "string") {
    add(title);
  }
  return own;
};

/**
 * The table of the elements `records` with `metamodel` (see the file comment); undefined when no
 * designation has another one.
 */
export const designationTable = (
  records: Iterable<ElementRecord>,
  metamodel: Metamodel,
): DesignationTable | undefined => {
  const keys = designationKeys(metamodel);
  if (keys.length === 0) {
    return undefined;
  }
  const invalid = invalidStatuses(metamodel);
  const reading: Reading = {
    keys,
    titleKey: titleKeyOf(metamodel),
    markdown: markdownKeysOf(metamodel),
    phrases: new Map(),
  };
  // Per designation the designations of every element that has it, itself included.
  const all = new Map<SearchPhrase, Set<SearchPhrase>>();
  for (const record of records) {
    const own = invalid.has(String(record.data["status"]))
      ? new Set<SearchPhrase>()
      : ownDesignations(reading, record);
    if (own.size < 2) {
      continue;
    }
    for (const phrase of own) {
      const set = all.get(phrase) ?? new Set();
      for (const other of own) {
        set.add(other);
      }
      all.set(phrase, set);
    }
  }
  const others = new Map<string, readonly SearchPhrase[]>();
  let longest = 0;
  for (const [phrase, set] of all) {
    set.delete(phrase);
    others.set(phrase.words.join(" "), [...set]);
    longest = Math.max(longest, phrase.words.length);
  }
  return others.size === 0 ? undefined : { others, longest };
};

/** A run of words of a query that is a designation: its words as written, and its other designations. */
export interface DesignationRun {
  readonly words: readonly string[];
  readonly others: readonly SearchPhrase[];
}

/** The runs of a query (`designationRuns`), and its other words outside quotes, in order. */
export interface QueryRuns {
  readonly runs: readonly DesignationRun[];
  readonly rest: readonly string[];
}

/** The runs of one stretch of a query (`designationRuns`), added to `runs`; its other words to `rest`. */
const runsIn = (
  table: DesignationTable,
  segment: readonly string[],
  runs: DesignationRun[],
  rest: string[],
): void => {
  const items = segment.map((word) => ({ word, words: wordsOf(word) }));
  const counted = items.filter((item) => item.words.length > 0);
  rest.push(...items.filter((item) => item.words.length === 0).map((item) => item.word));
  let at = 0;
  for (const [start, first] of counted.entries()) {
    if (start < at) {
      continue;
    }
    // The longest run from `first` on that is a key: its length in query words, 0 for none.
    let length = 0;
    let others: readonly SearchPhrase[] = [];
    const words: string[] = [];
    for (const [offset, item] of counted.slice(start).entries()) {
      words.push(...item.words);
      const found = words.length > table.longest ? undefined : table.others.get(words.join(" "));
      if (found !== undefined) {
        length = offset + 1;
        others = found;
      }
    }
    if (length === 0) {
      rest.push(first.word);
      at = start + 1;
    } else {
      runs.push({ words: counted.slice(start, start + length).map((item) => item.word), others });
      at = start + length;
    }
  }
};

/**
 * The runs of the query whose stretches between phrases are `segments` (`ParsedQuery.segments`):
 * left to right the longest run of words at each place that is a key of `table` (see the file
 * comment); the other words are `rest`.
 */
export const designationRuns = (
  table: DesignationTable,
  segments: readonly (readonly string[])[],
): QueryRuns => {
  const runs: DesignationRun[] = [];
  const rest: string[] = [];
  for (const segment of segments) {
    runsIn(table, segment, runs, rest);
  }
  return { runs, rest };
};
