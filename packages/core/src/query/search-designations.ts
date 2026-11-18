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
//   longest run of words that is a key of the table at that place (AK1), on the words the search
//   splits the query into (`wordsOf`: also at a hyphen, `Paket-Export` is `paket` and `export`), so a
//   run may start or end inside a query word; an overlapping shorter or later one does not count
//   (`a b c d` with the keys `a b` and `b c d` takes `a b`: SR-220 AK1, #1817). A query word without
//   a letter or digit is skipped, as the search leaves it out. A query word that runs touch only in
//   part needs all its words, as in the search without runs: it joins its runs and its other words
//   into one part (`QueryPart`), whose pieces must all be found. Its words that no run covers are
//   searched as words, as in the literal search of the query word (assumption of #1822), and a query
//   word that is an ID (`SR-220`) keeps that match only where no run splits it; the literal search
//   (`search-index.ts`) keeps it in every case.
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

/**
 * A word of a query outside quotes as the runs take it: as written (`SR-220`), or, where a run splits
 * it, the words (`wordsOf`) of one piece, searched as words only.
 */
export type QueryWord = string | readonly string[];

/** A run of words of a query that is a designation: its words, and its other designations. */
export interface DesignationRun {
  readonly words: readonly QueryWord[];
  readonly others: readonly SearchPhrase[];
}

/**
 * Query words found together (see the file comment): one without runs, or the words that runs and
 * split query words join, with their runs and the words of the split ones that no run covers.
 */
export interface QueryPart {
  readonly runs: readonly DesignationRun[];
  readonly rest: readonly QueryWord[];
}

/** The parts of a query outside quotes (`designationRuns`), in order. */
export interface QueryRuns {
  readonly parts: readonly QueryPart[];
}

/** A run being built: its words grow per query word it touches. */
interface Building {
  readonly words: QueryWord[];
  readonly others: readonly SearchPhrase[];
}

/**
 * Per word of `words`, the run that covers it (an index of the returned runs) or -1: left to right,
 * the longest key of `table` at each place (see the file comment).
 */
const runsOver = (table: DesignationTable, words: readonly string[]): [number[], Building[]] => {
  const covering = new Array<number>(words.length).fill(-1);
  const runs: Building[] = [];
  let start = 0;
  while (start < words.length) {
    let length = 0;
    let others: readonly SearchPhrase[] = [];
    for (let end = start + 1; end <= Math.min(words.length, start + table.longest); end++) {
      const found = table.others.get(words.slice(start, end).join(" "));
      if (found !== undefined) {
        length = end - start;
        others = found;
      }
    }
    if (length === 0) {
      start++;
    } else {
      covering.fill(runs.length, start, start + length);
      runs.push({ words: [], others });
      start += length;
    }
  }
  return [covering, runs];
};

/** The parts of one stretch of a query (`designationRuns`), added to `parts`. */
const partsIn = (table: DesignationTable, segment: readonly string[], parts: QueryPart[]): void => {
  const items = segment.map((word) => ({ word, words: wordsOf(word) }));
  const [covering, runs] = runsOver(
    table,
    items.flatMap((item) => item.words),
  );
  let part: { readonly runs: Building[]; readonly rest: QueryWord[] } | undefined;
  // The run of the last word counted so far, -1 for none.
  let last = -1;
  let at = 0;
  for (const { word, words } of items) {
    const by = covering.slice(at, at + words.length);
    at += words.length;
    if (by.every((run) => run < 0)) {
      // No run touches it (also a word without a letter or digit): a part of its own, as written.
      parts.push({ runs: [], rest: [word] });
      last = words.length === 0 ? last : -1;
      continue;
    }
    if (part === undefined || by[0] !== last || last < 0) {
      part = { runs: [], rest: [] };
      parts.push(part);
    }
    const uncovered = words.filter((_, k) => by[k] === -1);
    for (const run of new Set(by)) {
      const building = runs[run];
      if (building !== undefined) {
        const mine = words.filter((_, k) => by[k] === run);
        building.words.push(mine.length === words.length ? word : mine);
        if (!part.runs.includes(building)) {
          part.runs.push(building);
        }
      }
    }
    if (uncovered.length > 0) {
      part.rest.push(uncovered);
    }
    last = by.reduce((_, run) => run, last);
  }
};

/**
 * The parts of the query whose stretches between phrases are `segments` (`ParsedQuery.segments`):
 * left to right the longest run of words at each place that is a key of `table`, and the query words
 * that runs split joined with them (see the file comment).
 */
export const designationRuns = (
  table: DesignationTable,
  segments: readonly (readonly string[])[],
): QueryRuns => {
  const parts: QueryPart[] = [];
  for (const segment of segments) {
    partsIn(table, segment, parts);
  }
  return { parts };
};
