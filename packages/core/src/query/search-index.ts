// The full-text search index of an element store (ADR-0008 "Search", SR-068): MiniSearch over the
// title, the text and the property values of every element, with fuzzy and prefix search in any
// case, and the IDs (UUID and short ID) matched beside it. `element.search` (SR-068, ThomasBirkmaier/ReqSeq-archive#80) combines
// it with the selection of a view or filter (SR-068 AK3: `within`), the `[[` link search (SR-066)
// restricts it to some fields (`fields`), and SR-098 asks for the first hits within 300 ms at
// 50,000 elements (`offset`, `limit`: only one page of hits is described).
//
// What an element is found by (one MiniSearch document per element record, keyed by repository and
// file, since files may share a UUID, SR-088):
// - `title`: the value of the property with the meaning `title` (D-059, `titleKeyOf`);
// - `text`: the Markdown text below the frontmatter, read from the file (the store keeps no text,
//   ADR-0008), without the destinations of its links and images (`markdownLinks`): what the reader
//   sees is the label, and the destinations of inline references (`reqseq:<UUID>?version=...`) would
//   add four times the words of the texts at N-036, none of them a word of the text;
// - `properties`: the values of every other frontmatter key except `id` and the keys that hold
//   relations (relation kinds and properties of kind `relation`, `relationKey`: their values are
//   UUIDs of other elements): text, numbers and booleans, also inside lists and mappings, and for a
//   value of a choice property also the name of the choice, which is what the tool shows; so too
//   the type and the status (fields of their own, D-012): by the name the metamodel gives them, by
//   the key as written when it gives none (SR-068 "Properties", ThomasBirkmaier/ReqSeq-archive#80; the name only, since the key
//   mostly holds the same words, which would cost the build a fifth more time at N-036);
// - `property:<key>`, one field per property a search can be restricted to (SR-216 AK2,
//   `searchPropertyKeys`: not the title, no relations, no key of a fixed field), after the three
//   above in metamodel order: the same texts of that key as `properties` holds, a choice also by
//   the names of its values. A document without the key has the empty text there, so field lengths
//   and averages do not depend on the order documents were added in (a carried or cached index
//   scores as a fresh build). The three fields above keep their IDs, lengths and words, so a search
//   in all fields scores as before these fields existed (SR-216 AK4). A search restricted to
//   fields scores only the words of those fields (SR-216 AK1); a hit found in `property:<key>`
//   names `properties`;
// - `type` and `status`, after them: the names of the type and the status again, as `properties`
//   holds them (the empty text for a document without one), never searched, scored or matched. They
//   tell a word found only through these names from one found elsewhere (SR-068 AK5,
//   `ScoringOptions.named`): such a hit comes after the others (`before`);
// - `id`: the UUID, the short ID (D-017) and the identifier (ThomasBirkmaier/ReqSeq-archive#305), compared with the records of the
//   store, not indexed (150,000 random tokens would cost about 110 MB and 1 s at N-036): a word that
//   is a short ID as written (`SR-46fb54`, also with the 12 digits of the file name) finds the
//   elements of a type with that prefix whose UUID ends with its digits; a word of at least 6 hex
//   digits and dashes finds the UUIDs that begin or end with it; a word that is the whole
//   identifier of an element (the property with the meaning `identifier`, `SR-036`) finds it. The
//   short ID the tool shows may grow when another UUID ends the same way (SR-084); the comparison
//   does not depend on that, so every shown short ID still finds its element. Matched exactly (in
//   any case), never fuzzy. The identifier is a property value too, so its words are also found as
//   words (`036`).
// Word parts (SR-221): a term of a query word outside quotes with at least `MIN_PART` letters and no
// digit also matches the words that hold it after their start ("seite" in "Paketseite"), without a
// typo, in the fields searched (`withParts`, `scoreWords` with the vocabulary of
// `search-vocabulary.ts`). It counts less than a whole word or a word start (search-scoring.ts),
// and as found by the word itself for the late and other groups. Phrases, other designations and
// the ID comparison never match a part. A hit tells the words found only as a word start or a part
// (`SearchHit.parts`), so the snippet and the title mark only that part (SR-221 AK3).
// Acceptance criteria (SR-222, `search-criteria.ts`): criterion keys are no words of the index; a
// query word that is one (also after `AK-`) also counts in each criterion with that key, exactly, when
// the acceptance criteria property is searched (`criteriaFound`). A criterion reference that fits
// (`referenceFit`) is an ID match of its requirements and found in their criterion; its words are
// searched as an ID word's, except in these requirements, and it splits the stretch of the query that
// other designations are looked for in, so no run takes its words.
//
// Words are split at every character that is not a letter, a mark or a digit, and compared in
// Unicode normal form NFC and lower case (SR-068 AK2: "andere Groß- und Kleinschreibung"). A typo
// is tolerated by fuzzy search (SR-068 AK2: "Tippfehler"): one edit in a word of 4 to 7 letters, two
// from 8 (MiniSearch's fraction 0.2, rounded), none in a shorter query word or in a query word
// with a digit (a number, a version, a part of an ID: one edit makes it another). The rule is about
// the word searched for: `sensorx` still finds `Sensor1`, one edit away.
//
// Words in quotes are a phrase (SR-068 AK4, `phrase-text.ts`): the index keeps no word positions,
// so the documents that hold its words in a field searched are checked against the texts of that
// field (`phraseFound`): the title, the text the engine keeps (`SearchEngine.documents`), or one
// value of a property as `properties` holds it. The indexed texts stay as they are (SR-216 AK4).
//
// Other designations (SR-220, `search-designations.ts`): a run of words outside quotes that is a
// designation of an element (its title, a synonym or its translation) is also found where one of its
// other designations stands, as an open phrase in the fields searched (`othersFound`). What the
// query finds by its words stays as it is, scores and all (AK5: without the meanings in the
// metamodel nothing else happens); the hits found only through the runs are added, as `other`, after
// the literal ones and before the late ones (AK2, `withOthers`). The table of designations is built
// per index, from the records of its store (`designationsIn`). The `[[` link search (SR-066) is
// expanded too, in the title.
//
// Built once per store and metamodel, in the calling thread, in slices with a turn of the event
// loop between them (as the current versions, ADR-0008), and carried over a change of the store:
// the documents of the changed files are replaced in the same MiniSearch object (see
// `carrySearchIndex`), so a save costs the files it wrote, not a build.
//
// The code is in three modules: building and carrying the index (`search-build.ts`), finding the
// documents a query finds (this module), and the result, its order and its hits
// (`search-results.ts`). This module is the entry point and exports the API of all three.
import { acceptanceCriteriaKeyOf } from "../model/acceptance-criteria.js";
import type { Query, SearchOptions } from "minisearch";
import type { Metamodel } from "../metamodel/index.js";
import { UNKNOWN_TYPE_PREFIX, findType, markdownKeysOf } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { criterionKeysOf, titleKeyOf } from "../model/index.js";
import { identifierMatch } from "../model/identifier-index.js";
import type { ParsedQuery, QueryPhrase, SearchPhrase } from "./phrase-text.js";
import {
  WORD_SEPARATOR,
  findPhrase,
  inLine,
  normalizeWord,
  parseQuery,
  visibleText,
  wordsOf,
} from "./phrase-text.js";
import type { DesignationRun, QueryPart, QueryRuns, QueryWord } from "./search-designations.js";
import { designationRuns } from "./search-designations.js";
import { queryKeyOf, queryReferenceOf } from "./search-criteria.js";
import type { ScoringOptions } from "./search-scoring.js";
import {
  keyScoreOf,
  nextShortId,
  phraseCandidates,
  scoreDocuments,
  scoreWords,
  searchOptionsOf,
  shortIdOfDocument,
} from "./search-scoring.js";
import type { SearchDocument, SearchField, SearchIndex } from "./search-build.js";
import {
  NAMED,
  NAMED_FIELDS,
  PROPERTY_FIELD,
  SEARCH_FIELDS,
  WORD_FIELDS,
  designationsIn,
  documentsOf,
  identifiedIn,
  keyTexts,
  keyedIn,
  placeIn,
  propertyField,
  recordKey,
} from "./search-build.js";
import type { Found, RankedHit, SearchElementsOptions, SearchResults, WordsMatch } from "./search-results.js";
import { order, pageOf, roundScore } from "./search-results.js";

export type {
  BuildControl,
  BuiltSearchIndex,
  ElementNow,
  SearchDocument,
  SearchEngine,
  SearchField,
  SearchIndex,
  WordField,
} from "./search-build.js";
export {
  PAUSE_MS,
  SEARCH_FIELDS,
  SLICE_MS,
  SearchBuildCancelled,
  WORD_FIELDS,
  buildSearchIndex,
  carrySearchIndex,
  docKey,
  documentOf,
  documentWithText,
  elementNow,
  engineOptions,
  engineOptionsFor,
  prepareSearchIndex,
  propertiesText,
  recordKey,
  searchIndexOf,
  searchPropertyKeys,
  valueTexts,
} from "./search-build.js";
export type { RankedHit, SearchElementsOptions, SearchHit, SearchResults } from "./search-results.js";
export { describeHit } from "./search-results.js";

export { WORD_SEPARATOR, normalizeWord, visibleText };

/** Letters a word needs for fuzzy search: in a shorter one an edit would find most words. */
export const MIN_FUZZY = 4;
/** Letters a word needs for prefix search. */
export const MIN_PREFIX = 2;
/** Letters a word needs to be found inside longer words (SR-221 AK1: "mindestens 4 Buchstaben"). */
export const MIN_PART = 4;
const LETTER = /\p{L}/gu;
/**
 * A query word with a digit is never matched with a typo: it is a number, a version or a part of an
 * ID, and one edit would make it another (`0000b3` would find `0000b1`, `2026` would find `2025`).
 * A word of the index with a digit can still be the typo of a query word without one.
 */
const DIGIT = /\p{N}/u;

/**
 * Whether a query term is also found inside longer words (SR-221 AK1): at least `MIN_PART` letters
 * (marks and other characters do not count) and no digit, as a number would be found in every
 * longer number.
 */
const findsParts = (term: string): boolean =>
  !DIGIT.test(term) && [...term.matchAll(LETTER)].length >= MIN_PART;

/**
 * `scoring` for the words of a query outside quotes (SR-221 AK1, `wordsFound`): their terms also
 * find the words they stand inside (`findsParts`), and their word starts and parts are marked as
 * such (AK3). Phrases and other designations keep `scoring`: whole words, the last as a word start.
 */
export const withParts = (scoring: ScoringOptions): ScoringOptions => ({ ...scoring, parts: findsParts });

/** The weight of a field: a match in the title counts twice. */
const boostOf = (field: string): number => (field === "title" ? 2 : 1);

/** A short ID (`SR-46fb54`; `common.schema.json#/$defs/shortId`). */
const SHORT_ID = /^[A-Z][A-Z0-9]*-[0-9a-f]{6,32}$/;
/** Hex digits and dashes: a UUID, a part of one or a tail of digits. */
const HEX = /^[0-9a-f-]+$/;
/** Digits a word must have to be compared with the UUIDs: as many as a short ID shows at least (SR-084). */
const MIN_ID_DIGITS = 6;
/** The last part of a UUID: its last 12 digits. */
const UUID_TAIL = 12;

/** Whether the UUID `id` ends with the hex digits `digits` (without dashes). */
const endsWithDigits = (id: string, digits: string): boolean =>
  digits.length <= UUID_TAIL ? id.endsWith(digits) : id.replaceAll("-", "").endsWith(digits);

/**
 * How one word of a query matches UUIDs and short IDs (see the file comment), or undefined when it
 * matches none: a test of a record.
 */
const shortIdMatcher = (
  word: string,
  metamodel: Metamodel,
): ((record: ElementRecord) => boolean) | undefined => {
  const dash = word.indexOf("-");
  const prefix = word.slice(0, dash).toUpperCase();
  const digits = word.slice(dash + 1).toLowerCase();
  if (dash > 0 && SHORT_ID.test(`${prefix}-${digits}`)) {
    return (record) =>
      endsWithDigits(record.id, digits) &&
      (findType(metamodel, record.type)?.prefix ?? UNKNOWN_TYPE_PREFIX) === prefix;
  }
  const lower = word.toLowerCase();
  const hex = lower.replaceAll("-", "");
  if (!HEX.test(lower) || hex.length < MIN_ID_DIGITS) {
    return undefined;
  }
  return (record) => record.id.startsWith(lower) || endsWithDigits(record.id, hex);
};

/** No criterion key found (`Found.keys`). */
const NO_KEYS: readonly string[] = [];

/** The keys of two sides of a hit. */
const joinKeys = (a: readonly string[], b: readonly string[]): readonly string[] =>
  b.length === 0 ? a : a.length === 0 ? b : [...a, ...b];

/**
 * How a word of a query is found in acceptance criteria (SR-222): the criterion key, and the keys
 * (`recordKey`) of the records with a criterion that carries it (of a criterion reference only those
 * it fits).
 */
interface CriteriaMatch {
  readonly key: string;
  readonly records: readonly string[];
  /** How many records have a criterion with the key, for its relevance (`keyScoreOf`). */
  readonly count: number;
}

/**
 * The records of `keys` (`recordKey`) in `index`: every key of `keyedIn` names one of its records,
 * as the map is built from, or carried with, its store; one that did not would be left out.
 */
const recordsOf = (index: SearchIndex, keys: readonly string[]): ElementRecord[] =>
  keys.map((at) => index.records.get(at)).filter((record): record is ElementRecord => record !== undefined);

/** How one word of a query matches IDs (`idMatcher`). */
interface IdMatch {
  /** Whether it matches a record of the index's store. */
  readonly test: (record: ElementRecord) => boolean;
  /** The only records it can match, when it is an identifier and no short ID; else every record. */
  readonly among: Iterable<ElementRecord> | undefined;
}

const ANY = (): boolean => true;

/**
 * How one word of a query matches IDs: UUIDs, short IDs and identifiers (see the file comment), or
 * undefined when it matches none.
 */
const idMatcher = (word: string, index: SearchIndex): IdMatch | undefined => {
  const short = shortIdMatcher(word, index.metamodel);
  const named = identifiedIn(index).get(identifierMatch(word));
  if (named === undefined) {
    return short === undefined ? undefined : { test: short, among: undefined };
  }
  return short === undefined
    ? { test: ANY, among: named }
    : { test: (record) => named.has(record) || short(record), among: undefined };
};

/**
 * The records a criterion reference `word` fits (SR-222 AK2): those its element reference names by
 * identifier or short ID (no UUID: the reference of a test name has one of these) that have exactly
 * one criterion with its key (SR-205 AK1: a key two criteria carry gives neither a reference); of the
 * whole store, as IDs are matched. Undefined when `word` is no criterion reference or fits none.
 */
const referenceFit = (index: SearchIndex, word: string): CriteriaMatch | undefined => {
  const reference = queryReferenceOf(word);
  if (reference === undefined) {
    return undefined;
  }
  const { ref, key } = reference;
  const keyed = keyedIn(index).get(key);
  if (keyed === undefined) {
    return undefined;
  }
  const named = identifiedIn(index).get(identifierMatch(ref));
  const short = SHORT_ID_REF.test(ref) ? shortIdMatcher(ref, index.metamodel) : undefined;
  const records = recordsOf(index, keyed).filter(
    (record) =>
      (named?.has(record) === true || short?.(record) === true) &&
      criterionKeysOf(index.metamodel, record.type, record.data)?.keys.filter((one) => one === key).length ===
        1,
  );
  return records.length === 0 ? undefined : { key, records: records.map(recordKey), count: keyed.length };
};

/** A short ID as a reference names it: a prefix, a dash and hex digits, in any case. */
const SHORT_ID_REF = /^[a-z][a-z0-9]*-[0-9a-f]{6,32}$/iu;

/**
 * The records with a criterion that carries the key `word` names (SR-222 AK1, `queryKeyOf`); undefined
 * when it names none.
 */
const keyFit = (index: SearchIndex, word: string): CriteriaMatch | undefined => {
  const key = queryKeyOf(word);
  const records = key === undefined ? undefined : keyedIn(index).get(key);
  return key === undefined || records === undefined ? undefined : { key, records, count: records.length };
};

/** One search: the index, which records count, and MiniSearch's options. */
interface Search {
  readonly index: SearchIndex;
  /** Whether the record of `key` is one of the index's store (and of `within`). */
  readonly admit: (record: ElementRecord | undefined, key: string) => record is ElementRecord;
  readonly scoring: ScoringOptions;
  /** `scoring` with word parts, for the words outside quotes (`withParts`). */
  readonly words: ScoringOptions;
  readonly options: SearchOptions;
  /** The place of the repository of a record (`Found.place`). */
  readonly placeOf: (record: ElementRecord) => number;
}

/**
 * The scoring options of a search of `searched` (the MiniSearch fields: `WordField`s and
 * `propertyField`s), as `SearchElementsOptions.fuzzy` and `prefix` say.
 */
export const scoringOf = (searched: readonly string[], fuzzy: number, prefix: boolean): ScoringOptions => ({
  fields: searched,
  boost: Object.fromEntries(searched.map((field) => [field, boostOf(field)])),
  fuzzy: (term) => term.length >= MIN_FUZZY && !DIGIT.test(term) && fuzzy,
  prefix: (term) => term.length >= MIN_PREFIX && prefix,
  named: NAMED,
});

/** The search of `options` in `searched` (the MiniSearch fields). */
const searchOf = (
  index: SearchIndex,
  searched: readonly string[],
  options: SearchElementsOptions,
): Search => {
  const within = options.within === undefined ? undefined : new Set(Array.from(options.within, recordKey));
  const admit = (record: ElementRecord | undefined, key: string): record is ElementRecord =>
    record !== undefined && (within === undefined || within.has(key));
  const scoring = scoringOf(searched, options.fuzzy ?? 0.2, options.prefix ?? true);
  return {
    index,
    admit,
    scoring,
    words: withParts(scoring),
    options: searchOptionsOf(scoring),
    placeOf: placeIn(index.layout),
  };
};

/**
 * The documents found for `queries` (each a word of the user's query, whose parts must all match:
 * `v1.2`), combined with `and` or not. A document whose record is not in this index's store (a
 * carried index shares its MiniSearch object with the next store's, `carrySearchIndex`) is no hit
 * of this index. With `and` the words are scored as MiniSearch scores them, but in arrays
 * (`scoreWords`, SR-098); MiniSearch searches itself with `or`. A list, not a map by key: a query
 * whose words cannot be IDs needs no combination. `scoring` is that of the words outside quotes
 * (`Search.words`, word parts included, SR-221) or, by default, that of phrases and other
 * designations (`Search.scoring`); with `or` no word part is found, since MiniSearch finds none
 * (no command searches with `or`).
 */
const wordsFound = (
  search: Search,
  queries: readonly string[],
  and: boolean,
  scoring: ScoringOptions = search.scoring,
): Found[] => {
  const { index } = search;
  const found: Found[] = [];
  if (and) {
    const scored = scoreWords(index.engine.mini, index.engine.generation, queries, scoring);
    const documents = documentsOf(index);
    for (let at = 0; at < scored.docs.length; at++) {
      const doc = Number(scored.docs[at]);
      const element = documents.records[doc];
      const key = String(documents.keys[doc]);
      if (search.admit(element, key)) {
        found.push({
          key,
          element,
          place: Number(documents.places[doc]),
          score: Number(scored.scores[at]),
          matches: [{ scored, doc }],
          phrases: [],
          ids: 0,
          keys: NO_KEYS,
          late: scored.late(doc),
          other: false,
        });
      }
    }
    return found;
  }
  const query: Query = {
    queries: queries.map((word) => ({ queries: [word], combineWith: "AND" })),
    combineWith: "OR",
  };
  const { mini, generation } = index.engine;
  // Late when a word that found it found it late (SR-068 AK5): each word scored on its own.
  const late = new Uint8Array(nextShortId(mini));
  for (const word of queries) {
    const scored = scoreWords(mini, generation, [word], search.scoring);
    for (const doc of scored.docs) {
      if (scored.late(doc)) {
        late[doc] = 1;
      }
    }
  }
  for (const result of mini.search(query, search.options)) {
    const key = String(result.id);
    const element = index.records.get(key);
    if (search.admit(element, key)) {
      found.push({
        key,
        element,
        place: search.placeOf(element),
        score: result.score,
        matches: [result],
        phrases: [],
        ids: 0,
        keys: NO_KEYS,
        late: late[Number(shortIdOfDocument(mini, key))] === 1,
        other: false,
      });
    }
  }
  return found;
};

/** `found` by key. */
const byKey = (found: Iterable<Found>): Map<string, Found> =>
  new Map(Array.from(found, (one) => [one.key, one]));

/**
 * Marks in `found` (and adds to it) every record of the index that `ids` matches: its word is found
 * in an ID, so not late (SR-068 AK5).
 */
const idsFound = (search: Search, ids: IdMatch, found: Map<string, Found>): void => {
  for (const record of ids.among ?? search.index.store.elements) {
    const key = ids.test(record) ? recordKey(record) : undefined;
    if (key !== undefined && search.admit(record, key)) {
      const known = found.get(key);
      if (known === undefined) {
        found.set(key, {
          key,
          element: record,
          place: search.placeOf(record),
          score: 0,
          matches: [],
          phrases: [],
          ids: 1,
          keys: NO_KEYS,
          late: false,
          other: false,
        });
      } else {
        known.ids = 1;
        // Only this word's own matches are in `found`; `combine` adds the late flags of the others after.
        known.late = false;
      }
    }
  }
};

/**
 * Marks in `found` (and adds to it) every record of `criteria` the search admits: the key is found in
 * its criterion (SR-222 AK1, AK2), so in `properties`, not late, and it adds the score of one rare
 * word (`keyScoreOf`: by relevance like a word).
 */
const criteriaFound = (search: Search, criteria: CriteriaMatch, found: Map<string, Found>): void => {
  const { key, records, count } = criteria;
  const score = keyScoreOf(search.index.engine.mini, count);
  const keys = [key];
  for (const at of records) {
    const record = search.index.records.get(at);
    if (search.admit(record, at)) {
      const known = found.get(at);
      if (known === undefined) {
        found.set(at, {
          key: at,
          element: record,
          place: search.placeOf(record),
          score,
          matches: [],
          phrases: [],
          ids: 0,
          keys,
          late: false,
          other: false,
        });
      } else {
        known.score += score;
        known.keys = joinKeys(known.keys, keys);
        known.late = false;
      }
    }
  }
};

/**
 * `a` and `b` combined: the documents of both (`and`) or of either (`or`); scores add up, and a
 * document is late when it is late on a side that found it.
 */
const combine = (a: Map<string, Found>, b: ReadonlyMap<string, Found>, and: boolean): Map<string, Found> => {
  const out = new Map<string, Found>();
  for (const [key, found] of a) {
    const other = b.get(key);
    if (other !== undefined) {
      out.set(key, {
        key,
        element: found.element,
        place: found.place,
        score: found.score + other.score,
        matches: [...found.matches, ...other.matches],
        phrases: [...found.phrases, ...other.phrases],
        ids: found.ids + other.ids,
        keys: joinKeys(found.keys, other.keys),
        late: found.late || other.late,
        other: found.other || other.other,
      });
    } else if (!and) {
      out.set(key, found);
    }
  }
  if (!and) {
    for (const [key, other] of b) {
      if (!a.has(key)) {
        out.set(key, other);
      }
    }
  }
  return out;
};

/**
 * Every hit of `query` in the order of `searchElements` (ID matches, then hits not found only through
 * a type or status name, then those found by every word itself, then score, then store order), the
 * scores rounded first as there, without describing them: a grouped search (element.search `group`,
 * SR-149 AK6) deals them into groups and describes only its page (`describeHit`).
 */
export const rankedHits = (
  index: SearchIndex,
  query: string,
  options: Omit<SearchElementsOptions, "offset" | "limit"> = {},
): readonly RankedHit[] =>
  Array.from(foundBy(index, query, options) ?? [], (one) => {
    one.score = roundScore(one.score);
    return one;
  }).sort(order);

/** The fixed fields a search of `options` searches, and its MiniSearch fields of words (`propertyField`s included). */
const fieldsOf = (
  options: SearchElementsOptions,
): { readonly fields: ReadonlySet<SearchField>; readonly searched: readonly string[] } => {
  const fields = new Set(options.fields ?? (options.propertyKeys === undefined ? SEARCH_FIELDS : []));
  const keys = options.propertyKeys ?? [];
  return {
    fields,
    searched: [...WORD_FIELDS.filter((field) => fields.has(field)), ...keys.map(propertyField)],
  };
};

/**
 * A word or phrase of a query that may be an ID: whether it is also searched in the fields of words,
 * and how it matches IDs; a phrase is searched as one (`phraseFound`).
 */
interface SpecialWord {
  readonly word: string;
  readonly text: boolean;
  readonly ids?: IdMatch | undefined;
  readonly phrase?: SearchPhrase | undefined;
  /** How it is found in acceptance criteria (SR-222 AK1, AK2), when their property is searched. */
  readonly criteria?: CriteriaMatch | undefined;
  /**
   * The requirements a criterion reference fits (SR-222 AK2): its words count nowhere in them, and
   * it is no word of designation runs.
   */
  readonly reference?: CriteriaMatch;
}

/** What `queryWords` takes besides the words: the fields searched and the criterion references that fit. */
interface QueryContext {
  readonly fields: ReadonlySet<SearchField>;
  readonly searched: readonly string[];
  /** Whether the property with the meaning acceptance criteria is searched (SR-216 AK2, SR-222 AK1). */
  readonly criteria: boolean;
  /** The words of the query outside quotes that are criterion references that fit (`referenceFit`). */
  readonly references: ReadonlyMap<string, CriteriaMatch>;
}

/**
 * A criterion reference that fits as a special word, as an ID word is one (SR-222 AK2): its words searched as words (`text`), but not in the requirements it fits; an ID match of
 * these when `id` is searched, and found in their criterion when the acceptance criteria property
 * is. Undefined when it can match nothing.
 */
const referenceWord = (
  index: SearchIndex,
  found: { readonly word: string; readonly text: boolean; readonly phrase?: SearchPhrase },
  fit: CriteriaMatch,
  context: QueryContext,
): SpecialWord | undefined => {
  const among = recordsOf(index, fit.records);
  const ids = context.fields.has("id") ? { test: ANY, among } : undefined;
  const criteria = context.criteria ? fit : undefined;
  return ids === undefined && criteria === undefined && !found.text
    ? undefined
    : { ...found, ids, criteria, reference: fit };
};

/** The words and phrases of a query (`queryWords`). */
interface QueryWords {
  readonly plain: readonly string[];
  readonly special: readonly SpecialWord[];
  readonly phrases: readonly SearchPhrase[];
}

/**
 * The words `words` of a query outside quotes as `queryWords` takes them, and whether one of them can
 * match nothing in the fields searched (`void`). A piece of a word that a run of other designations
 * splits (`QueryWord`, SR-220) is its words, searched as one word whose parts must all match.
 */
const wordsOfQuery = (
  index: SearchIndex,
  words: readonly QueryWord[],
  context: QueryContext,
): { readonly plain: string[]; readonly special: SpecialWord[]; readonly void: boolean } => {
  const { fields, searched } = context;
  const plain: string[] = [];
  const special: SpecialWord[] = [];
  let found = false;
  for (const word of words) {
    if (typeof word !== "string") {
      // Its words have a letter or digit, and runs exist only with fields of words (`foundBy`);
      // split by a run, it is no ID (see `search-designations.ts`).
      plain.push(word.join(" "));
      continue;
    }
    const hasWord = wordsOf(word).length > 0;
    const text = searched.length > 0 && hasWord;
    const fit = context.references.get(word);
    if (fit !== undefined) {
      const reference = referenceWord(index, { word, text }, fit, context);
      if (reference === undefined) {
        found = true;
      } else {
        special.push(reference);
      }
      continue;
    }
    const ids = fields.has("id") ? idMatcher(word, index) : undefined;
    const criteria = context.criteria ? keyFit(index, word) : undefined;
    if (ids !== undefined || criteria !== undefined) {
      special.push({ word, text, ids, criteria });
    } else if (text) {
      plain.push(word);
    } else {
      found ||= hasWord;
    }
  }
  return { plain, special, void: found };
};

/**
 * The words of `parsed` (`parseQuery`): the words outside quotes searched as words only (`plain`),
 * the phrases (SR-068 AK4), and the words and phrases that may be IDs (`special`: a phrase that is
 * an ID as a whole); undefined when a word or phrase can match nothing in the fields searched (one
 * with letters or digits, but no field of words and no ID form) and every word must match (SR-216
 * AK1). A word or phrase without a letter or digit, or one that can match nothing while any word
 * is enough, is left out. The last word of a phrase without a closing quote also matches the words
 * it begins when `prefix` is on, whatever its length (SR-068 AK4 names no minimum).
 */
const queryWords = (
  index: SearchIndex,
  parsed: ParsedQuery,
  context: QueryContext,
  options: { readonly and: boolean; readonly prefix: boolean },
): QueryWords | undefined => {
  const { and } = options;
  const { plain, special, void: none } = wordsOfQuery(index, parsed.words, context);
  if (none && and) {
    return undefined;
  }
  const phrases = queryPhrases(index, parsed.phrases, { ...options, context }, special);
  return phrases === undefined ? undefined : { plain, special, phrases };
};

/**
 * The phrases of a query as `queryWords` takes them: those that may be IDs added to `special`, the
 * others given; undefined when one can match nothing and every one must match.
 */
const queryPhrases = (
  index: SearchIndex,
  parsed: readonly QueryPhrase[],
  options: {
    readonly and: boolean;
    readonly prefix: boolean;
    readonly context: QueryContext;
  },
  special: SpecialWord[],
): SearchPhrase[] | undefined => {
  const { context } = options;
  const phrases: SearchPhrase[] = [];
  for (const { content, words: inQuotes, open } of parsed) {
    if (inQuotes.length === 0) {
      continue;
    }
    const phrase: SearchPhrase = {
      words: inQuotes,
      prefix: open && options.prefix,
    };
    const whole = content.trim();
    // A criterion reference alone in quotes is one as without them (SR-222 AK2).
    const text = context.searched.length > 0;
    const fit = referenceFit(index, whole);
    if (fit !== undefined) {
      const reference = referenceWord(index, { word: content, text, phrase }, fit, context);
      if (reference !== undefined) {
        special.push(reference);
      } else if (options.and) {
        return undefined;
      }
      continue;
    }
    const ids = context.fields.has("id") ? idMatcher(whole, index) : undefined;
    const criteria = context.criteria ? keyFit(index, whole) : undefined;
    if (ids !== undefined || criteria !== undefined) {
      special.push({ word: content, text, ids, phrase, criteria });
    } else if (text) {
      phrases.push(phrase);
    } else if (options.and) {
      return undefined;
    }
  }
  return phrases;
};

/** What the check of a phrase in the properties takes from the metamodel, looked up once per phrase. */
interface PhraseKeys {
  readonly metamodel: Metamodel;
  readonly titleKey: string | undefined;
  readonly markdownKeys: ReadonlySet<string>;
}

/**
 * Where a phrase stands in a field of a document (`phraseIn`): nowhere, only in the name of its type
 * or status (SR-068 AK5), or elsewhere.
 */
type PhrasePlace = "none" | "named" | "elsewhere";

/**
 * Where `phrase` stands in one value of the properties of `record` (`properties`, or the one
 * property `only`), as the index holds them (`keyTexts`), a Markdown one by units and without its
 * link destinations (`visibleText`). The text of a key in `document` (`SearchDocument.parts`, its
 * values one per line) is looked at first: a place in it within one line (`inLine`) is one in a
 * value; only for another one are the values of the key read (SR-098). A place in the type or
 * status name counts as `named` only when there is none in another key.
 */
const phraseInProperties = (
  keys: PhraseKeys,
  record: ElementRecord,
  document: SearchDocument,
  only: string | undefined,
  phrase: SearchPhrase,
): PhrasePlace => {
  const { metamodel, titleKey, markdownKeys } = keys;
  const { parts } = document;
  let named = false;
  for (let at = 0; at < parts.length; at += 2) {
    const key = String(parts[at]);
    const isNamed = NAMED_FIELDS.includes(key);
    if (only !== undefined && key !== only) {
      continue;
    }
    const markdown = markdownKeys.has(key);
    const part = String(parts[at + 1]);
    // Before the first link of a Markdown value (its `](`), its text is the visible one: a place
    // that ends there is one in the visible text (`visibleText`), which is read only for another.
    const link = markdown ? part.indexOf("](") : -1;
    let joined = part;
    let place = findPhrase(part, phrase);
    if (link >= 0 && (place === undefined || link < place.end)) {
      joined = visibleText(part);
      place = findPhrase(joined, phrase);
    }
    if (
      place !== undefined &&
      (inLine(joined, place) ||
        keyTexts(metamodel, titleKey, key, record.data[key]).some(
          (text) => findPhrase(markdown ? visibleText(text) : text, phrase, markdown) !== undefined,
        ))
    ) {
      if (!isNamed) {
        return "elsewhere";
      }
      named = true;
    }
  }
  return named ? "named" : "none";
};

/** `elsewhere` when `found`, else `none`. */
const phrasePlace = (found: boolean): PhrasePlace => (found ? "elsewhere" : "none");

/**
 * Where `phrase` stands in `field` of `record` (see the file comment): in the title, in the text by
 * units (`findPhrase`), or in one value of the properties (`phraseInProperties`).
 */
const phraseIn = (
  keys: PhraseKeys,
  record: ElementRecord,
  document: SearchDocument,
  field: string,
  phrase: SearchPhrase,
): PhrasePlace => {
  if (field === "title") {
    return phrasePlace(findPhrase(document.title, phrase) !== undefined);
  }
  if (field === "text") {
    return phrasePlace(findPhrase(document.text, phrase, true) !== undefined);
  }
  return phraseInProperties(
    keys,
    record,
    document,
    field === "properties" ? undefined : field.slice(PROPERTY_FIELD.length),
    phrase,
  );
};

/**
 * The scoring of a phrase in one field: its words without a typo, the last also as a word start
 * when the phrase is open (`SearchPhrase.prefix`).
 */
const phraseScoring = (field: string, phrase: SearchPhrase): ScoringOptions => ({
  fields: [field],
  boost: { [field]: boostOf(field) },
  fuzzy: () => false,
  prefix: (_term, i, terms) => phrase.prefix && i === terms.length - 1,
});

/** The word matches of a hit that only a phrase found: none. */
const NO_MATCHES: readonly WordsMatch[] = [];

/**
 * The documents `phrase` stands in (SR-068 AK4), by key: per field searched the documents that hold
 * its words there (`phraseCandidates`), checked against their texts (`phraseIn`). A document is
 * scored per field the phrase stands in, as its words in that field are (`scoreWords`), and these
 * scores add up; its hit names only these fields (SR-174 AK6, SR-216 AK1). It is late when the
 * phrase stands only in the name of its type or status (SR-068 AK5).
 */
const phraseFound = (search: Search, phrase: SearchPhrase): Map<string, Found> => {
  if (phrase.words.length === 1) {
    // One word stands wherever the index holds it as a word: a word search without a typo.
    const scoring = { ...search.scoring, fuzzy: () => false as const, prefix: () => phrase.prefix };
    return byKey(wordsFound({ ...search, scoring }, phrase.words, true));
  }
  const { index } = search;
  const { mini, generation } = index.engine;
  const documents = documentsOf(index);
  const { metamodel } = index;
  const keys = { metamodel, titleKey: titleKeyOf(metamodel), markdownKeys: markdownKeysOf(metamodel) };
  // By short ID, not by key, while the fields are gone through (SR-098): each hit and its fields.
  const found = new Map<string, Found>();
  const hits = new Array<Found | undefined>(nextShortId(mini));
  for (const field of search.scoring.fields) {
    const docs: number[] = [];
    const elements: ElementRecord[] = [];
    const named: boolean[] = [];
    for (const doc of phraseCandidates(mini, phrase, field)) {
      const element = documents.records[doc];
      const document = documents.documents[doc];
      if (search.admit(element, String(documents.keys[doc])) && document !== undefined) {
        const place = phraseIn(keys, element, document, field, phrase);
        if (place !== "none") {
          docs.push(doc);
          elements.push(element);
          named.push(place === "named");
        }
      }
    }
    if (docs.length === 0) {
      continue;
    }
    const scores = scoreDocuments(
      mini,
      generation,
      [phrase.words.join(" ")],
      phraseScoring(field, phrase),
      docs,
    );
    for (const [at, element] of elements.entries()) {
      const doc = Number(docs[at]);
      const score = Number(scores[at]);
      const known = hits[doc];
      if (known === undefined) {
        const key = String(documents.keys[doc]);
        const hit: Found = {
          key,
          element,
          place: Number(documents.places[doc]),
          score,
          matches: NO_MATCHES,
          phrases: [{ phrase, fields: [field] }],
          ids: 0,
          keys: NO_KEYS,
          late: named[at] === true,
          other: false,
        };
        hits[doc] = hit;
        found.set(key, hit);
      } else {
        known.score += score;
        known.late &&= named[at] === true;
        for (const one of known.phrases) {
          one.fields.push(field);
        }
      }
    }
  }
  return found;
};

/** The documents the words and phrases `split` find, each once; none when it has none. */
const splitFound = (search: Search, split: QueryWords, and: boolean): Iterable<Found> => {
  const { plain, special, phrases } = split;
  const byWords = plain.length === 0 ? undefined : wordsFound(search, plain, and, search.words);
  if (special.length === 0 && phrases.length === 0) {
    return byWords ?? [];
  }
  // The parts in this order, each combined with those before (special and phrases: at least one).
  const parts = byWords === undefined ? [] : [byKey(byWords)];
  for (const { word, text, ids, phrase, criteria, reference } of special) {
    const matched = !text
      ? new Map<string, Found>()
      : phrase === undefined
        ? byKey(wordsFound(search, [word], true, search.words))
        : phraseFound(search, phrase);
    // The words of a criterion reference count nowhere in the requirements it fits (SR-222 AK2).
    for (const at of reference?.records ?? []) {
      matched.delete(at);
    }
    if (ids !== undefined) {
      idsFound(search, ids, matched);
    }
    if (criteria !== undefined) {
      criteriaFound(search, criteria, matched);
    }
    parts.push(matched);
  }
  for (const phrase of phrases) {
    parts.push(phraseFound(search, phrase));
  }
  return parts.reduce((found, part) => combine(found, part, and)).values();
};

/**
 * `a` and `b` united: the documents of either; scores add up, and a document is late only when every
 * side that found it found it late (SR-068 AK5: a word is late when it is found in no other field).
 */
const unite = (a: Map<string, Found>, b: ReadonlyMap<string, Found>): Map<string, Found> => {
  for (const [key, one] of b) {
    const known = a.get(key);
    a.set(
      key,
      known === undefined
        ? one
        : {
            ...known,
            score: known.score + one.score,
            matches: [...known.matches, ...one.matches],
            phrases: [...known.phrases, ...one.phrases],
            ids: known.ids + one.ids,
            keys: joinKeys(known.keys, one.keys),
            late: known.late && one.late,
          },
    );
  }
  return a;
};

/**
 * The documents in which one of the designations `others` stands (SR-220 AK1): as whole words in
 * order, without a typo, in any case, the last word also as a word start, within one unit of one
 * field searched (`phraseFound`); one of one word as a word search without a typo, its word as a word
 * start.
 */
const othersFound = (search: Search, others: readonly SearchPhrase[]): Map<string, Found> => {
  const scoring: ScoringOptions = { ...search.scoring, fuzzy: () => false, prefix: () => true };
  const words: Search = { ...search, scoring, options: searchOptionsOf(scoring) };
  const found = new Map<string, Found>();
  // Each one on its own: they are alternatives of one part, so a document is late only when every
  // designation that found it found it late (`unite`), not when one did.
  for (const phrase of others) {
    unite(
      found,
      phrase.words.length === 1 ? byKey(wordsFound(words, phrase.words, true)) : phraseFound(search, phrase),
    );
  }
  return found;
};

/**
 * The documents the query finds when each of its runs (in `joined`) is also found through its other
 * designations (SR-220 AK1): per run, its words or one of its other designations; per part, its runs
 * and its other words all (a word split by a run needs all its words, as in the literal search); the
 * parts with the rest of the query (`rest`), combined with `and` or not; `take` gives the words of
 * some query words (`wordsOfQuery`).
 */
const expandedFound = (
  search: Search,
  rest: QueryWords,
  joined: readonly [QueryPart, ...QueryPart[]],
  options: { readonly and: boolean; readonly take: (words: readonly QueryWord[]) => QueryWords },
): Map<string, Found> => {
  const { and, take } = options;
  const runFound = (run: DesignationRun): Map<string, Found> =>
    unite(byKey(splitFound(search, take(run.words), and)), othersFound(search, run.others));
  const partFound = (part: QueryPart): Map<string, Found> => {
    let found = part.runs.map(runFound).reduce((all, one) => combine(all, one, true));
    if (part.rest.length > 0) {
      found = combine(found, byKey(splitFound(search, take(part.rest), true)), true);
    }
    return found;
  };
  const [first, ...more] = joined;
  let found = partFound(first);
  for (const part of more) {
    found = combine(found, partFound(part), and);
  }
  const whole = rest.plain.length === 0 && rest.special.length === 0 && rest.phrases.length === 0;
  return whole ? found : combine(byKey(splitFound(search, rest, and)), found, and);
};

/**
 * The hits of `literal` (what the query finds by its words) with those of `expanded` (what it finds
 * through other designations as well, SR-220): a document found by every word itself and not late
 * keeps its hit; one found only through another designation, or late before and no longer late
 * through it, is `other` (AK2). Every hit holds the places of the other designations found in it, to
 * mark them (AK3).
 */
const withOthers = (literal: Iterable<Found>, expanded: ReadonlyMap<string, Found>): Iterable<Found> => {
  const out = byKey(literal);
  for (const [key, one] of expanded) {
    const known = out.get(key);
    out.set(
      key,
      known === undefined || (known.late && !one.late)
        ? { ...one, other: true }
        : {
            ...known,
            matches: [...known.matches, ...one.matches],
            phrases: [...known.phrases, ...one.phrases],
            keys: joinKeys(known.keys, one.keys),
          },
    );
  }
  return out.values();
};

/** A query without runs of other designations. */
const NO_RUNS: QueryRuns = { parts: [] };

/** `segment` split at the words of `at`, which are left out. */
const splitAt = (segment: readonly string[], at: ReadonlyMap<string, unknown>): string[][] => {
  const out: string[][] = [[]];
  for (const word of segment) {
    if (at.has(word)) {
      out.push([]);
    } else {
      out.at(-1)?.push(word);
    }
  }
  return out.filter((part) => part.length > 0);
};

/**
 * What the words of `parsed` are searched with (`QueryContext`): whether the acceptance criteria
 * property is searched (all properties, or it alone), and the criterion references among the words
 * outside quotes that fit (SR-222 AK2).
 */
const queryContext = (
  index: SearchIndex,
  parsed: ParsedQuery,
  fields: ReadonlySet<SearchField>,
  searched: readonly string[],
): QueryContext => {
  const criteriaKey = acceptanceCriteriaKeyOf(index.metamodel);
  const criteria =
    criteriaKey !== undefined && (fields.has("properties") || searched.includes(propertyField(criteriaKey)));
  const references = new Map<string, CriteriaMatch>();
  for (const word of parsed.words) {
    const fit = references.has(word) ? undefined : referenceFit(index, word);
    if (fit !== undefined) {
      references.set(word, fit);
    }
  }
  return { fields, searched, criteria, references };
};

/** The documents `query` finds in `index`, each once (see `searchElements`); undefined for a query without a word. */
const foundBy = (
  index: SearchIndex,
  query: string,
  options: SearchElementsOptions,
): Iterable<Found> | undefined => {
  const { fields, searched } = fieldsOf(options);
  const and = options.combineWith !== "or";
  const parsed = parseQuery(query);
  const context = queryContext(index, parsed, fields, searched);
  const split = queryWords(index, parsed, context, { and, prefix: options.prefix ?? true });
  if (split === undefined) {
    return undefined;
  }
  const search = searchOf(index, searched, options);
  const literal = splitFound(search, split, and);
  // Other designations only in fields of words (SR-220); without a table the search is SR-068's (AK5).
  const table = searched.length === 0 ? undefined : designationsIn(index);
  // A criterion reference that fits is no word of a run: it splits its stretch as a phrase does (SR-222 AK2).
  const segments =
    context.references.size === 0
      ? parsed.segments
      : parsed.segments.flatMap((segment) => splitAt(segment, context.references));
  const { parts } = table === undefined ? NO_RUNS : designationRuns(table, segments);
  const [first, ...more] = parts.filter((part) => part.runs.length > 0);
  if (first === undefined) {
    return literal;
  }
  // The rest of the query: its words outside the runs, and its phrases, those that may be IDs too.
  const rest = parts.filter((part) => part.runs.length === 0).flatMap((part) => part.rest);
  const restOutside = wordsOfQuery(index, rest, context);
  const restWords = {
    ...restOutside,
    special: [
      ...restOutside.special,
      ...split.special.filter((one) => one.phrase !== undefined || one.reference !== undefined),
    ],
    phrases: split.phrases,
  };
  const take = (words: readonly QueryWord[]): QueryWords => ({
    ...wordsOfQuery(index, words, context),
    phrases: [],
  });
  return withOthers(literal, expandedFound(search, restWords, [first, ...more], { and, take }));
};

/**
 * The elements of `index` that `query` finds, the best first: each word of the query (split at
 * white space) is searched in the words of the fields (fuzzy, prefix) and compared with the IDs;
 * the words are combined with `options.combineWith`. Elements whose ID a word matched come first
 * (by the number of such words), then those without a word found only through the name of their
 * type or status (SR-068 AK5), then by score; equal ones keep store order. A word without a
 * letter or digit is left out; a word with one that can match nothing in the fields searched (no
 * ID form with only `id`) finds nothing with `and` and is left out with `or`; a query without a
 * word finds nothing. Only the page (`offset`, `limit`) is described (`fields`, `terms`).
 *
 * The words without an ID form are searched as one query, scored as MiniSearch scores it but in
 * arrays (`scoreWords`, SR-098); a word that may be an ID is searched on its own and joined with the
 * elements whose ID it matches. Only the first `offset + limit` hits are put in order.
 */
export const searchElements = (
  index: SearchIndex,
  query: string,
  options: SearchElementsOptions = {},
): SearchResults => pageOf(foundBy(index, query, options) ?? [], options);

/**
 * The elements `searchElements` finds for `query`, all of them, without sorting or describing them: the
 * elements of `element.search` over all pages (`answer`, SR-224 AK5).
 */
export const matchingElements = (
  index: SearchIndex,
  query: string,
  options: Omit<SearchElementsOptions, "offset" | "limit">,
): readonly ElementRecord[] => Array.from(foundBy(index, query, options) ?? [], (found) => found.element);

/**
 * The keys (`recordKey`) of the elements `searchElements` finds for `query`, all of them, without
 * sorting or describing them: the condition `text` of a filter (SR-068, `condition.ts`).
 */
export const matchingKeys = (
  index: SearchIndex,
  query: string,
  options: Omit<SearchElementsOptions, "offset" | "limit"> = {},
): ReadonlySet<string> => new Set(Array.from(foundBy(index, query, options) ?? [], (found) => found.key));
