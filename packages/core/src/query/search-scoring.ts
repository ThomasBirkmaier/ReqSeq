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
// Besides, it tells which documents a query word found only through the names of their type or
// status (`Scored.late`, SR-068 AK5): `properties` holds these names among the other values, and
// the fields `type` and `status` hold them again (`ScoringOptions.named`), never scored or matched.
// A term is found elsewhere in a document when a word it matches is there in another searched
// field, or in `properties` more often than in `type` and `status` together (the same tokenizer, so
// the counts are exact).
//
// It reads MiniSearch's index, which its types declare protected (`Internals`): the version is
// pinned (packages/core/package.json), and the test above fails when another version scores
// differently. The index never holds words of discarded documents: a carry removes every document
// it replaces with the document it added (`carrySearchIndex`), also in an index loaded from the
// cache, so every document a word names is one of MiniSearch's.
import type MiniSearch from "minisearch";
import type { MatchInfo, SearchOptions } from "minisearch";
import type { SearchPhrase } from "./phrase-text.js";

/** Term frequencies of one word: by field ID, by document ID (MiniSearch's `FieldTermData`). */
type TermData = ReadonlyMap<number, ReadonlyMap<number, number>>;

/** MiniSearch's index of words (a `SearchableMap`, a radix tree), as far as scoring reads it. */
interface WordTree {
  get(term: string): TermData | undefined;
  atPrefix(prefix: string): Iterable<[string, TermData]>;
  fuzzyGet(term: string, maxEditDistance: number): Map<string, [TermData, number]>;
}

/** MiniSearch's words per field of each document (a `Map` by short ID). */
type FieldLengths = ReadonlyMap<number, readonly number[]>;

/** What scoring reads of a MiniSearch 7.2.0 object (protected members, see the file comment). */
interface Internals {
  readonly _index: WordTree;
  readonly _documentCount: number;
  /** Document IDs by the short IDs MiniSearch numbers the documents with. */
  readonly _documentIds: ReadonlyMap<number, unknown>;
  /** Short IDs by document ID. */
  readonly _idToShortId: ReadonlyMap<unknown, number>;
  readonly _fieldIds: Readonly<Record<string, number>>;
  /** Words per field of each document, by short ID and field ID. */
  readonly _fieldLength: FieldLengths;
  readonly _avgFieldLength: readonly number[];
  readonly _nextId: number;
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
  /**
   * The field `in` holds the texts of the fields `fields` among others (`properties` the type and
   * status names): a term found in `in` no more often than in those fields together is found only
   * through them (`Scored.late`). Those fields are never scored or matched; none: nothing is late.
   */
  readonly named?: { readonly in: string; readonly fields: readonly string[] };
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

/** Field lengths by short ID and field: per MiniSearch object and change. */
interface Lengths {
  readonly generation: number;
  readonly fields: number;
  /** Whole numbers (MiniSearch counts the distinct words of a field). */
  readonly lengths: Uint32Array;
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
  const lengths = new Uint32Array(inner._nextId * fields);
  for (const [doc, perField] of inner._fieldLength) {
    for (const [field, length] of perField.entries()) {
      lengths[doc * fields + field] = length;
    }
  }
  const built = { generation, fields, lengths };
  lengthsCache.set(mini, built);
  return built;
};

/**
 * The `Lengths` of `mini` after its change `generation`, derived from those of `generation - 1`
 * when they were built (#215): only the documents `removed` (their short IDs before the change)
 * and `added` (after it) are looked at, the arrays are copied. Otherwise nothing is kept, and they
 * are built in full at the end of the carry (`prepareSearchIndex`, `lengthsOf`). The lengths of a removed document are never read.
 */
export const carryLengths = (
  mini: MiniSearch,
  generation: number,
  removed: readonly number[],
  added: readonly number[],
): void => {
  const known = lengthsCache.get(mini);
  if (known?.generation !== generation - 1) {
    return;
  }
  const inner = internals(mini);
  const { fields } = known;
  const lengths = new Uint32Array(inner._nextId * fields);
  lengths.set(known.lengths);
  // No search reads a removed document (MiniSearch's words no longer name it); cleared anyway, as a
  // fresh build has it.
  for (const doc of removed) {
    lengths.fill(0, doc * fields, (doc + 1) * fields);
  }
  for (const doc of added) {
    const of = inner._fieldLength.get(doc);
    /* v8 ignore else -- every document MiniSearch holds has its lengths, an added one too. */
    if (of !== undefined) {
      for (const [field, length] of of.entries()) {
        lengths[doc * fields + field] = length;
      }
    }
  }
  lengthsCache.set(mini, { generation, fields, lengths });
};

/** The documents a query found, with their scores, and what matched in one of them. */
export interface Scored {
  /** Short IDs of the documents. */
  readonly docs: readonly number[];
  /** Their scores, as MiniSearch's results give them (`score`). */
  readonly scores: Float64Array;
  /** MiniSearch's `match` of the document with short ID `doc`: each word that matched, with its fields. */
  readonly matchOf: (doc: number) => MatchInfo;
  /**
   * Whether a term of the query found the document `doc` (one of `docs`) only through the fields of
   * `ScoringOptions.named` (see the file comment): SR-068 AK5.
   */
  readonly late: (doc: number) => boolean;
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
  /** Index of the last term found elsewhere than only through `ScoringOptions.named`; -1 none. */
  readonly elsewhere: Int32Array;
  /** 1 for a document a term found only through `ScoringOptions.named`. */
  readonly late: Uint8Array;
  /** The field ID of `ScoringOptions.named.in` (-1 none), and those of its fields (`namedOf`). */
  readonly namedIn: number;
  readonly namedFields: readonly number[];
}

/**
 * The frequencies of `derived` per document in the fields of `ScoringOptions.named`, or undefined
 * when it is in none of them: then every document it is in `named.in` holds it elsewhere.
 */
const namedOf = (run: Run, derived: Derived): ReadonlyMap<number, number>[] | undefined => {
  let out: ReadonlyMap<number, number>[] | undefined;
  for (const field of run.namedFields) {
    const frequencies = derived.data.get(field);
    if (frequencies !== undefined) {
      (out ??= []).push(frequencies);
    }
  }
  return out;
};

/** How often the fields of `named` (`namedOf`) hold the word in the document `doc`. */
const namedFrequency = (named: readonly ReadonlyMap<number, number>[], doc: number): number => {
  let sum = 0;
  for (const frequencies of named) {
    sum += frequencies.get(doc) ?? 0;
  }
  return sum;
};

/**
 * Adds the scores of `derived` in the field `field` (MiniSearch's `termResults`) for term `at` to
 * `run.term`, for the documents that matched every term before; their short IDs, when first met,
 * to `met`.
 */
const addField = (run: Run, at: number, derived: Derived, field: string, met: number[]): void => {
  const fieldId = Number(run.inner._fieldIds[field]);
  const frequencies = derived.data.get(fieldId);
  if (frequencies === undefined) {
    return;
  }
  const { lengths, fields } = run.lengths;
  const matching = frequencies.size;
  const average = Number(run.inner._avgFieldLength[fieldId]);
  const total = run.inner._documentCount;
  const idf = Math.log(1 + (total - matching + 0.5) / (matching + 0.5));
  // Term boost and document boost are 1 (MiniSearch: termWeight * termBoost * fieldBoost * docBoost * raw).
  const weight = derived.weight * Number(run.options.boost[field]);
  const named = fieldId === run.namedIn ? namedOf(run, derived) : undefined;
  for (const [doc, frequency] of frequencies) {
    const reached = run.reached[doc];
    if (reached === at - 1 || reached === at) {
      if (named === undefined || frequency > namedFrequency(named, doc)) {
        run.elsewhere[doc] = at;
      }
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
};

/** Scores term `at` (`spec`) into `run.term`; the documents that matched every term up to it. */
const scoreTerm = (run: Run, at: number, spec: Spec): number[] => {
  const met: number[] = [];
  for (const derived of spec.derived) {
    for (const field of run.options.fields) {
      addField(run, at, derived, field, met);
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
 * them (see the file comment).
 */
export const scoreWords = (
  mini: MiniSearch,
  generation: number,
  words: readonly string[],
  options: ScoringOptions,
): Scored => {
  const inner = internals(mini);
  const specs = specsOf(inner, words, options);
  const size = inner._nextId;
  const fieldIdOf = (field: string): number => inner._fieldIds[field] ?? -1;
  const run: Run = {
    options,
    inner,
    lengths: lengthsOf(mini, generation),
    reached: new Int32Array(size).fill(-1),
    term: new Float64Array(size),
    word: new Float64Array(size),
    total: new Float64Array(size),
    elsewhere: new Int32Array(size).fill(-1),
    late: new Uint8Array(size),
    namedIn: options.named === undefined ? -1 : fieldIdOf(options.named.in),
    namedFields: (options.named?.fields ?? []).map(fieldIdOf).filter((id) => id >= 0),
  };
  let found: number[] = [];
  let at = 0;
  for (const [w, terms] of specs.entries()) {
    found = [];
    for (const [t, spec] of terms.entries()) {
      const met = scoreTerm(run, at, spec);
      // A word's score: its terms added up in order (MiniSearch's `AND` combinator). A word is found
      // elsewhere when each of its terms is (SR-068 AK5).
      for (const doc of met) {
        run.word[doc] = t === 0 ? Number(run.term[doc]) : Number(run.word[doc]) + Number(run.term[doc]);
        if (run.elsewhere[doc] !== at) {
          run.late[doc] = 1;
        }
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
  return {
    docs: found,
    scores,
    matchOf: (doc) => matchOf(inner, specs.flat(), options, doc),
    late: (doc) => run.late[doc] === 1,
  };
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

/** MiniSearch's short ID of the document `key`; undefined when `mini` holds none. */
export const shortIdOfDocument = (mini: MiniSearch, key: string): number | undefined =>
  internals(mini)._idToShortId.get(key);

/**
 * The short IDs of the documents of `mini` that hold every word of `phrase` in the field `field` as
 * a word, the last one also as a word start when its `prefix` says so: the documents a phrase may
 * stand in there (`phrase-text.ts`), which only a look at their texts decides. `phrase` has a word.
 */
export const phraseCandidates = (
  mini: MiniSearch,
  phrase: Pick<SearchPhrase, "words" | "prefix">,
  field: string,
): number[] => {
  const inner = internals(mini);
  const fieldId = Number(inner._fieldIds[field]);
  const start = phrase.prefix ? phrase.words.at(-1) : undefined;
  const sets = (start === undefined ? phrase.words : phrase.words.slice(0, -1)).map(
    (word): ReadonlySet<number> | ReadonlyMap<number, number> =>
      inner._index.get(word)?.get(fieldId) ?? new Set<number>(),
  );
  // The documents of the word start, by short ID: a short one begins many words (SR-098).
  const begun = new Uint8Array(start === undefined ? 0 : inner._nextId);
  const begunDocs: number[] = [];
  for (const [, data] of start === undefined ? [] : inner._index.atPrefix(start)) {
    for (const doc of data.get(fieldId)?.keys() ?? []) {
      if (begun[doc] === 0) {
        begun[doc] = 1;
        begunDocs.push(doc);
      }
    }
  }
  let smallest: ReadonlySet<number> | ReadonlyMap<number, number> | undefined;
  for (const set of sets) {
    if (smallest === undefined || set.size < smallest.size) {
      smallest = set;
    }
  }
  // An open phrase of one word: the documents of its word start.
  const docs = smallest === undefined ? begunDocs : [...smallest.keys()];
  return docs.filter((doc) => (start === undefined || begun[doc] === 1) && sets.every((set) => set.has(doc)));
};
