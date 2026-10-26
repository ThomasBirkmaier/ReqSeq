// Scoring of a query whose words must all match (`combineWith: "AND"`), as MiniSearch 7.2.0's
// `search` scores it, on the same index, but in typed arrays (SR-098: the first hits within 300 ms
// at 50,000 elements). MiniSearch builds a result object per document and query word, merges them
// in maps, then a result per document, and sorts them all; at N-036 a two-letter prefix or a word
// of every text cost 250 to 350 ms that way, most of it for those objects. Here a query costs a
// few arrays of numbers per document, and only the documents of the page are described
// (`Scored.matchOf`).
//
// The result is MiniSearch's to the bit, which `search-scoring.test.ts` checks against `search`
// for many queries (and the performance suite on the generated 50,000 elements):
// - the same words: the query words split and processed by the engine's tokenizer and term
//   processing, a query word per nested query, every part of a word a term (`termToQuerySpec`);
// - the same terms per query term, in the same order: the term itself, then the words it begins
//   (`atPrefix`, nearer ones weighted more), then the words within its edit distance that are no
//   prefix match (`fuzzyGet`), with MiniSearch's default weights (prefix 0.375, fuzzy 0.45),
//   largest distance (6) and BM25 parameters (k 1.2, b 0.7, d 0.5);
// - the same arithmetic in the same order: the BM25 expression of MiniSearch's `calcBM25Score`,
//   weighted by term weight, field boost (document and term boost are 1), added up per document in
//   the order of the terms and fields, then per query word over its terms, then over the query
//   words, and multiplied by the number of different query terms (MiniSearch's `quality`; with
//   `AND` every document found matched all of them);
// - the same matched words and fields (`matchOf`): MiniSearch merges the matches of the query terms
//   with `Object.assign`, so a word is listed where it first matched, with the fields it is in.
//
// It reads MiniSearch's index, which its types declare protected (`Internals`): the version is
// pinned (packages/core/package.json), and the test above fails when another version scores
// differently. When the index holds words of discarded documents (an object loaded from the cache
// and carried, `carrySearchIndex`), MiniSearch cleans them up while it searches and counts them
// out of the document frequencies on the way; `scoreWords` leaves such an index to MiniSearch
// (undefined), so that both effects stay MiniSearch's.
import type MiniSearch from "minisearch";
import type { MatchInfo, SearchOptions } from "minisearch";

/** Term frequencies of one word: by field ID, by document ID (MiniSearch's `FieldTermData`). */
type TermData = ReadonlyMap<number, ReadonlyMap<number, number>>;

/** MiniSearch's index of words (a `SearchableMap`, a radix tree), as far as scoring reads it. */
interface WordTree {
  get(term: string): TermData | undefined;
  atPrefix(prefix: string): Iterable<[string, TermData]>;
  fuzzyGet(term: string, maxEditDistance: number): Map<string, [TermData, number]>;
}

/** What scoring reads of a MiniSearch 7.2.0 object (protected members, see the file comment). */
interface Internals {
  readonly _index: WordTree;
  readonly _documentCount: number;
  /** Document IDs by the short IDs MiniSearch numbers the documents with. */
  readonly _documentIds: ReadonlyMap<number, unknown>;
  readonly _fieldIds: Readonly<Record<string, number>>;
  /** Words per field of each document, by short ID and field ID. */
  readonly _fieldLength: ReadonlyMap<number, readonly number[]>;
  readonly _avgFieldLength: readonly number[];
  readonly _nextId: number;
  readonly _dirtCount: number;
  readonly _options: {
    readonly tokenize: (text: string) => string[];
    readonly processTerm: (term: string) => string | null | undefined | false;
  };
}

// Internal by design: the pinned version is checked by search-scoring.test.ts against `search`.
const internals = (mini: MiniSearch): Internals => mini as unknown as Internals;

/** MiniSearch's defaults (`defaultSearchOptions`): weights of prefix and fuzzy matches, largest edit distance, BM25. */
const PREFIX_WEIGHT = 0.375;
const FUZZY_WEIGHT = 0.45;
const MAX_FUZZY = 6;
const K = 1.2;
const B = 0.7;
const D = 0.5;

/**
 * The search options scoring takes: those of `searchOf` (search-index.ts). Preconditions, which
 * `scoreWords` does not check: every field of `fields` has a boost in `boost` and it is non-zero
 * (MiniSearch counts a missing or zero boost as 1, scoring uses the value as given), `fields` has no field twice, and `processTerm` of the engine returns a string for every
 * word that tokenizing gives (not null, undefined or false).
 */
export interface ScoringOptions {
  readonly fields: readonly string[];
  readonly boost: Readonly<Record<string, number>>;
  /** Per term: no fuzzy match (false or 0), a share of its length (below 1) or an edit distance. */
  readonly fuzzy: (term: string, i: number, terms: string[]) => number | false;
  readonly prefix: (term: string, i: number, terms: string[]) => boolean;
}

/** The scoring options are MiniSearch search options. */
export const searchOptionsOf = (options: ScoringOptions): SearchOptions => ({
  fields: [...options.fields],
  boost: { ...options.boost },
  fuzzy: options.fuzzy,
  prefix: options.prefix,
});

/** One word of the index that a query term matches, with its weight (1 for the term itself). */
interface Derived {
  readonly term: string;
  readonly weight: number;
  readonly data: TermData;
}

/** The words of the index that `term` matches, in MiniSearch's order (`executeQuerySpec`). */
const derivedTerms = (tree: WordTree, term: string, prefix: boolean, fuzzy: number | false): Derived[] => {
  const out: Derived[] = [];
  const exact = tree.get(term);
  if (exact !== undefined) {
    out.push({ term, weight: 1, data: exact });
  }
  // A share of the length below 1, else an edit distance (MiniSearch's `fuzzy`).
  const maxDistance =
    fuzzy === false ? 0 : fuzzy < 1 ? Math.min(MAX_FUZZY, Math.round(term.length * fuzzy)) : fuzzy;
  const near = maxDistance > 0 ? tree.fuzzyGet(term, maxDistance) : new Map<string, [TermData, number]>();
  if (prefix) {
    for (const [word, data] of tree.atPrefix(term)) {
      const distance = word.length - term.length;
      if (distance > 0) {
        near.delete(word);
        out.push({
          term: word,
          weight: (PREFIX_WEIGHT * word.length) / (word.length + 0.3 * distance),
          data,
        });
      }
    }
  }
  for (const [word, [data, distance]] of near) {
    if (distance > 0) {
      out.push({ term: word, weight: (FUZZY_WEIGHT * word.length) / (word.length + distance), data });
    }
  }
  return out;
};

/** Field lengths by short ID and field, and which short IDs are documents: per MiniSearch object and change. */
interface Lengths {
  readonly generation: number;
  readonly fields: number;
  readonly lengths: Float64Array;
  readonly live: Uint8Array;
}

const lengthsCache = new WeakMap<MiniSearch, Lengths>();

/** The `Lengths` of `mini` as it is after `generation` changes (`SearchEngine.generation`). */
export const lengthsOf = (mini: MiniSearch, generation: number): Lengths => {
  const known = lengthsCache.get(mini);
  if (known?.generation === generation) {
    return known;
  }
  const inner = internals(mini);
  const fields = Object.keys(inner._fieldIds).length;
  const lengths = new Float64Array(inner._nextId * fields);
  const live = new Uint8Array(inner._nextId);
  for (const [doc, perField] of inner._fieldLength) {
    for (const [field, length] of perField.entries()) {
      lengths[doc * fields + field] = length;
    }
  }
  for (const doc of inner._documentIds.keys()) {
    live[doc] = 1;
  }
  const built = { generation, fields, lengths, live };
  lengthsCache.set(mini, built);
  return built;
};

/** The documents a query found, with their scores, and what matched in one of them. */
export interface Scored {
  /** Short IDs of the documents. */
  readonly docs: readonly number[];
  /** Their scores, as MiniSearch's results give them (`score`). */
  readonly scores: Float64Array;
  /** MiniSearch's `match` of the document with short ID `doc`: each word that matched, with its fields. */
  readonly matchOf: (doc: number) => MatchInfo;
}

/** One term of the query: the derived words it matches. */
interface Spec {
  readonly term: string;
  readonly derived: readonly Derived[];
}

/** The state of one scoring: per short ID the scores so far, and the last term it matched all terms up to. */
interface Run {
  readonly options: ScoringOptions;
  readonly inner: Internals;
  readonly lengths: Lengths;
  /** Index of the last term (over all words) a document matched every term up to; -1 none. */
  readonly reached: Int32Array;
  /** Score of the current term, of the current word, and of the words so far. */
  readonly term: Float64Array;
  readonly word: Float64Array;
  readonly total: Float64Array;
}

/**
 * Adds the scores of `derived` in the field `field` (MiniSearch's `termResults`) for term `at` to
 * `run.term`, for the documents that matched every term before; their short IDs, when first met,
 * to `met`. False when it meets a document that is none (a word of a discarded document).
 */
const addField = (run: Run, at: number, derived: Derived, field: string, met: number[]): boolean => {
  const fieldId = Number(run.inner._fieldIds[field]);
  const frequencies = derived.data.get(fieldId);
  if (frequencies === undefined) {
    return true;
  }
  const { lengths, live, fields } = run.lengths;
  const matching = frequencies.size;
  const average = Number(run.inner._avgFieldLength[fieldId]);
  const total = run.inner._documentCount;
  const idf = Math.log(1 + (total - matching + 0.5) / (matching + 0.5));
  // Term boost and document boost are 1 (MiniSearch: termWeight * termBoost * fieldBoost * docBoost * raw).
  const weight = derived.weight * Number(run.options.boost[field]);
  for (const [doc, frequency] of frequencies) {
    if (live[doc] !== 1) {
      return false;
    }
    const reached = run.reached[doc];
    if (reached === at - 1 || reached === at) {
      const length = Number(lengths[doc * fields + fieldId]);
      const raw = idf * (D + (frequency * (K + 1)) / (frequency + K * (1 - B + (B * length) / average)));
      if (reached === at) {
        run.term[doc] = Number(run.term[doc]) + weight * raw;
      } else {
        run.reached[doc] = at;
        run.term[doc] = weight * raw;
        met.push(doc);
      }
    }
  }
  return true;
};

/** Scores term `at` (`spec`) into `run.term`; the documents that matched every term up to it, or undefined (see `addField`). */
const scoreTerm = (run: Run, at: number, spec: Spec): number[] | undefined => {
  const met: number[] = [];
  for (const derived of spec.derived) {
    for (const field of run.options.fields) {
      if (!addField(run, at, derived, field, met)) {
        return undefined;
      }
    }
  }
  return met;
};

/** The terms of the query, per word, as MiniSearch's `executeQuery` derives them. */
const specsOf = (inner: Internals, words: readonly string[], options: ScoringOptions): Spec[][] =>
  words.map((word) => {
    const terms = inner._options
      .tokenize(word)
      .map((token) => inner._options.processTerm(token))
      .filter((term): term is string => typeof term === "string" && term !== "");
    return terms.map((term, i) => ({
      term,
      derived: derivedTerms(
        inner._index,
        term,
        options.prefix(term, i, terms),
        options.fuzzy(term, i, terms),
      ),
    }));
  });

/**
 * The documents of `mini` (changed `generation` times, `SearchEngine.generation`) that match every
 * word of `words` (each a nested query whose terms must all match), scored as MiniSearch scores
 * them (see the file comment); undefined when MiniSearch must score them itself.
 */
export const scoreWords = (
  mini: MiniSearch,
  generation: number,
  words: readonly string[],
  options: ScoringOptions,
): Scored | undefined => {
  const inner = internals(mini);
  if (inner._dirtCount > 0) {
    return undefined;
  }
  const specs = specsOf(inner, words, options);
  const size = inner._nextId;
  const run: Run = {
    options,
    inner,
    lengths: lengthsOf(mini, generation),
    reached: new Int32Array(size).fill(-1),
    term: new Float64Array(size),
    word: new Float64Array(size),
    total: new Float64Array(size),
  };
  let found: number[] = [];
  let at = 0;
  for (const [w, terms] of specs.entries()) {
    found = [];
    for (const [t, spec] of terms.entries()) {
      const met = scoreTerm(run, at, spec);
      if (met === undefined) {
        return undefined;
      }
      // A word's score: its terms added up in order (MiniSearch's `AND` combinator).
      for (const doc of met) {
        run.word[doc] = t === 0 ? Number(run.term[doc]) : Number(run.word[doc]) + Number(run.term[doc]);
      }
      found = met;
      at += 1;
    }
    // The words added up in order; a word without a term matches nothing.
    for (const doc of found) {
      run.total[doc] = w === 0 ? Number(run.word[doc]) : Number(run.total[doc]) + Number(run.word[doc]);
    }
    if (found.length === 0) {
      break;
    }
  }
  const quality = new Set(specs.flat().map((spec) => spec.term)).size;
  const scores = new Float64Array(found.length);
  for (let i = 0; i < found.length; i++) {
    scores[i] = Number(run.total[Number(found[i])]) * quality;
  }
  return { docs: found, scores, matchOf: (doc) => matchOf(inner, specs.flat(), options, doc) };
};

/** MiniSearch's `match` of the document `doc` for the query terms `specs` (see the file comment). */
const matchOf = (
  inner: Internals,
  specs: readonly Spec[],
  options: ScoringOptions,
  doc: number,
): MatchInfo => {
  const match: MatchInfo = {};
  for (const { derived } of specs) {
    for (const { term, data } of derived) {
      const fields = options.fields.filter(
        (field) => data.get(Number(inner._fieldIds[field]))?.has(doc) === true,
      );
      if (fields.length > 0 && !Object.hasOwn(match, term)) {
        match[term] = fields;
      }
    }
  }
  return match;
};

/** The document IDs of `mini` by short ID (MiniSearch's `_documentIds`). */
export const documentKeys = (mini: MiniSearch): ReadonlyMap<number, unknown> => internals(mini)._documentIds;

/** The short ID MiniSearch gives the next document: every short ID is below it. */
export const nextShortId = (mini: MiniSearch): number => internals(mini)._nextId;
