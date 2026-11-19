// The result of a search (`searchElements` of `search-index.ts`): the documents found (`Found`),
// their order on the pages (`before`), the page, and the hit of each document on it (`hitOf`).
// `search-index.ts` exports this module's API, so importers use that module.
import type { SearchResult } from "minisearch";
import type { ElementRecord } from "../model/index.js";
import type { SearchPhrase } from "./phrase-text.js";
import type { Scored } from "./search-scoring.js";
import type { SearchField } from "./search-build.js";
import { PROPERTY_FIELD, SEARCH_FIELDS } from "./search-build.js";

/** How to search (`searchElements`). */
export interface SearchElementsOptions {
  /**
   * Only these fields, and the properties of `propertyKeys`; default every field (`SEARCH_FIELDS`),
   * or none besides those properties when `propertyKeys` is given.
   */
  readonly fields?: readonly SearchField[];
  /**
   * Also, or only, these single properties (SR-216 AK2): keys of `searchPropertyKeys` of the index's
   * metamodel. Not beside `properties` in `fields`, which holds them all (their words would count
   * twice); `searchFieldsOf` leaves them out then.
   */
  readonly propertyKeys?: readonly string[];
  /**
   * Only these element records, by repository and file (the selection of a view or filter, SR-068
   * AK3: `Selected.elements`; two files with one UUID are two records, SR-088); default all.
   */
  readonly within?: Iterable<Pick<ElementRecord, "repository" | "file">>;
  /** Whether every word of the query must match (`and`, the default) or one is enough (`or`). */
  readonly combineWith?: "and" | "or";
  /**
   * Edits tolerated in a word of at least `MIN_FUZZY` letters, as a share of its length
   * (MiniSearch's `fuzzy`, rounded); default 0.2, 0 for none.
   */
  readonly fuzzy?: number;
  /** Whether a word of at least `MIN_PREFIX` letters also finds the words it begins (as-you-type, the default). */
  readonly prefix?: boolean;
  /** Hits skipped before the page (default 0) and the most on the page (default all). */
  readonly offset?: number;
  readonly limit?: number;
}

/** One element found. */
export interface SearchHit {
  /** The record of the index's store. */
  readonly element: ElementRecord;
  /**
   * MiniSearch's relevance of the words (BM25, title counted twice), rounded to 6 significant digits
   * (`roundScore`); 0 for a match of the ID only.
   */
  readonly score: number;
  /** The fields a word of the query was found in, in the order of `SEARCH_FIELDS`. */
  readonly fields: readonly SearchField[];
  /**
   * The words of the element that matched words of the query outside quotes (lower case, NFC), for
   * highlighting; none for an ID.
   */
  readonly terms: readonly string[];
  /**
   * The words of `terms` that words of the query outside quotes found only as a word start (SR-068
   * AK2) or a word part (SR-221 AK1), each with those query words (processed as the index processes
   * them): their marks cover only that part (SR-221 AK3). A word also found as it is, with a typo,
   * as a phrase or as another designation is not among them, and is marked whole.
   */
  readonly parts: ReadonlyMap<string, readonly string[]>;
  /** The phrases of the query found in the element (SR-068 AK4), to mark them whole (SR-174 AK6). */
  readonly phrases: readonly SearchPhrase[];
  /**
   * The criterion keys found in its acceptance criteria (SR-222 AK1, AK2), each once, in lower case:
   * by a key word or a criterion reference, only when the acceptance criteria property is searched.
   */
  readonly keys: readonly string[];
}

/** The hits of a query: how many there are, and one page of them (`offset`, `limit`). */
export interface SearchResults {
  readonly total: number;
  readonly hits: readonly SearchHit[];
}

/** What found the words of a document: a result of MiniSearch, or a document of a scoring (`scoreWords`). */
export type WordsMatch = Pick<SearchResult, "match"> | { readonly scored: Scored; readonly doc: number };

/** A phrase of a query found in a document, and the fields (MiniSearch's) it stands in, in the order searched. */
export interface PhraseFound {
  readonly phrase: SearchPhrase;
  readonly fields: string[];
}

/** A document found: its record, the score of its words, what found it and whether it comes late. */
export interface Found {
  /** Its `recordKey`. */
  readonly key: string;
  readonly element: ElementRecord;
  /** The place of its record's repository in the store (`placesOf`); then its path orders it. */
  readonly place: number;
  score: number;
  /** What found its words; none for an ID only. Described for the page only (`hitOf`). */
  readonly matches: readonly WordsMatch[];
  /** The phrases found in it (`phraseFound`). */
  readonly phrases: readonly PhraseFound[];
  /** Words of the query that matched the ID. */
  ids: number;
  /** The criterion keys found in its criteria (`SearchHit.keys`), maybe more than once. */
  keys: readonly string[];
  /**
   * Whether a word or phrase of the query found it only through the name of its type or status
   * (SR-068 AK5): it comes after the hits without (`before`). Each source of a match sets it.
   */
  late: boolean;
  /**
   * Whether a part of the query found it only through another designation (SR-220 AK2,
   * `withOthers`): it comes after the hits found by every word itself, before the late ones.
   */
  readonly other: boolean;
}

/** The field of a hit that the MiniSearch field `field` is (`SearchHit.fields`). */
const hitField = (field: string): string => (field.startsWith(PROPERTY_FIELD) ? "properties" : field);

/** The fields a hit was found in by its IDs and criterion keys (SR-222: a key in `properties`). */
const fieldsBesideWords = (ids: number, keys: readonly string[]): string[] => [
  ...(ids > 0 ? ["id"] : []),
  ...(keys.length > 0 ? ["properties"] : []),
];

/**
 * The hit of one document: fields in the order of `SEARCH_FIELDS` (of a phrase only those it
 * stands in, SR-174 AK6), the words that matched, the phrases found.
 */
export const hitOf = ({ element, score, matches, phrases, ids, keys }: Found): SearchHit => {
  const fields = new Set<string>(fieldsBesideWords(ids, keys));
  const terms = new Set<string>();
  // Each word with a query word that found it only in part (`word\0query`), and the words found whole.
  const partial = new Set<string>();
  const whole = new Set<string>();
  for (const words of matches) {
    const match = "match" in words ? words.match : words.scored.matchOf(words.doc);
    const parts = "match" in words ? undefined : words.scored.partsOf(words.doc);
    for (const [term, found] of Object.entries(match)) {
      terms.add(term);
      for (const field of found) {
        fields.add(hitField(field));
      }
      const queried = parts?.get(term);
      if (queried === undefined) {
        whole.add(term);
      } else {
        for (const one of queried) {
          partial.add(`${term}\0${one}`);
        }
      }
    }
  }
  const parts = new Map<string, readonly string[]>();
  for (const pair of partial) {
    const at = pair.indexOf("\0");
    const term = pair.slice(0, at);
    const queried = pair.slice(at + 1);
    if (!whole.has(term)) {
      parts.set(term, [...(parts.get(term) ?? []), queried]);
    }
  }
  for (const found of phrases) {
    for (const field of found.fields) {
      fields.add(hitField(field));
    }
  }
  return {
    element,
    score,
    fields: SEARCH_FIELDS.filter((field) => fields.has(field)),
    terms: [...terms],
    parts,
    phrases: [...new Set(phrases.map((found) => found.phrase))],
    keys: [...new Set(keys)],
  };
};

/**
 * A score rounded to 6 significant digits, as hits give it and are sorted by: MiniSearch's scores of
 * equal documents may differ in the last bits between a fresh build, a cached one and one carried
 * many times (its average field lengths are kept incrementally), and every access must give the
 * same hits in the same order (SR-080).
 */
export const roundScore = (score: number): number => Number(score.toPrecision(SCORE_DIGITS));

const SCORE_DIGITS = 6;

/**
 * Whether `a` comes before `b` on the pages: more words matched its ID, else it is not late and `b`
 * is (a word found only through the name of the type or status, SR-068 AK5), else it was found by
 * every word itself and `b` was not (`Found.other`, SR-220 AK2), else a higher score,
 * else it comes first in the store (by repository, then path: no position of every record is
 * needed, #215). A strict total order (no two hits share a repository and file), so any way of
 * finding the first hits gives the same page.
 */
const before = (a: Found, b: Found): boolean =>
  a.ids !== b.ids
    ? a.ids > b.ids
    : a.late !== b.late
      ? b.late
      : a.other !== b.other
        ? b.other
        : a.score !== b.score
          ? a.score > b.score
          : a.place !== b.place
            ? a.place < b.place
            : a.element.file < b.element.file;

export const order = (a: Found, b: Found): number => (before(a, b) ? -1 : 1);

/**
 * The first `size` of `hits` in page order (`before`), without sorting the rest: the first ones so
 * far are kept in order, so a hit after the last of them (most hits, when 50 of 50,000 are asked
 * for, SR-098) costs one comparison, and one before it a binary search.
 */
const firstOf = (hits: Iterable<Found>, size: number): Found[] => {
  const first: Found[] = [];
  for (const hit of hits) {
    const last = first.at(-1);
    if (first.length < size || (last !== undefined && before(hit, last))) {
      let low = 0;
      let high = first.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const kept = first[middle];
        if (kept !== undefined && before(kept, hit)) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      first.splice(low, 0, hit);
      if (first.length > size) {
        first.pop();
      }
    }
  }
  return first;
};

/** The most hits `firstOf` finds; more are sorted (a binary search and a move per hit would cost more). */
const MAX_FIRST = 1000;

/** The page of `found`, the best first (see `searchElements`). */
export const pageOf = (found: Iterable<Found>, options: SearchElementsOptions): SearchResults => {
  const all = Array.from(found, (one) => {
    one.score = roundScore(one.score);
    return one;
  });
  const offset = options.offset ?? 0;
  const end = options.limit === undefined ? all.length : offset + options.limit;
  const first = end <= MAX_FIRST && end < all.length ? firstOf(all, end) : all.sort(order);
  return { total: all.length, hits: first.slice(offset, end).map(hitOf) };
};

/** One hit of `rankedHits`, as the search found it; `describeHit` gives it as `searchElements` does. */
export type RankedHit = Readonly<Found>;

/** A hit of `rankedHits` with its score, fields and terms, as `searchElements` gives it. */
export const describeHit = (hit: RankedHit): SearchHit => hitOf(hit);
