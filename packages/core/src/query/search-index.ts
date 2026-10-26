// The full-text search index of an element store (ADR-0008 "Search", SR-068): MiniSearch over the
// title, the text and the property values of every element, with fuzzy and prefix search in any
// case, and the IDs (UUID and short ID) matched beside it. `element.search` (SR-068, #80) combines
// it with the selection of a view or filter (SR-068 AK3: `within`), the `[[` link search (SR-066)
// restricts it to some fields (`fields`), and SR-098 asks for the first hits within 300 ms at
// 50,000 elements (`offset`, `limit`: only one page of hits is described).
//
// What an element is found by (one MiniSearch document per element record, keyed by repository and
// file, since files may share a UUID, SR-088):
// - `title`: the value of the property with the meaning `title` (D-059, `titleKeyOf`);
// - `text`: the Markdown text below the frontmatter, read from the file (the store keeps no text,
//   ADR-0008), without the destinations of its links and images (`markdownLinks`): what the reader
//   sees is the label, and the destinations of inline references (`logreq:<UUID>?version=...`) would
//   add four times the words of the texts at N-036, none of them a word of the text;
// - `properties`: the values of every other frontmatter key except `id`, `type` and `status` (fields
//   of their own, D-012) and the keys that hold relations (relation kinds and properties of kind
//   `relation`, `relationKey`: their values are UUIDs of other elements): text, numbers and
//   booleans, also inside lists and mappings, and for a value of a choice property also the name
//   of the choice, which is what the tool shows;
// - `id`: the UUID and the short ID (D-017), compared with the records of the store, not indexed
//   (150,000 random tokens would cost about 110 MB and 1 s at N-036): a word that is a short ID as
//   written (`SR-46fb54`, also with the 12 digits of the file name) finds the elements of a type
//   with that prefix whose UUID ends with its digits; a word of at least 6 hex digits and dashes
//   finds the UUIDs that begin or end with it. The short ID the tool shows may grow when another
//   UUID ends the same way (SR-084); the comparison does not depend on that, so every shown short
//   ID still finds its element. Matched exactly (in any case), never fuzzy.
// Words are split at every character that is not a letter, a mark or a digit, and compared in
// Unicode normal form NFC and lower case (SR-068 AK2: "andere Groß- und Kleinschreibung"). A typo
// is tolerated by fuzzy search (SR-068 AK2: "Tippfehler"): one edit in a word of 4 to 7 letters, two
// from 8 (MiniSearch's fraction 0.2, rounded), none in a shorter word.
//
// Built once per store and metamodel, in the calling thread, in slices with a turn of the event
// loop between them (as the current versions, ADR-0008), and carried over a change of the store:
// the documents of the changed files are replaced in the same MiniSearch object (see
// `carrySearchIndex`), so a save costs the files it wrote, not a build.
import { setTimeout as delay, setImmediate as nextTurn } from "node:timers/promises";
import MiniSearch from "minisearch";
import type { Options, Query, SearchOptions, SearchResult } from "minisearch";
import { readElementBodySync } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { UNKNOWN_TYPE_PREFIX, findType, keyDefinition } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, RepositoryContents } from "../model/index.js";
import { classifyFile, markdownLinks, relationKey, titleKeyOf } from "../model/index.js";
import { STRUCTURAL_KEYS } from "../model/elements.js";
import type { StoreUpdate } from "../model/store.js";
import type { WorkspaceLayout } from "../workspace/index.js";

/** What a hit was found in. */
export type SearchField = "title" | "text" | "properties" | "id";

/** Every field, in the order hits name them. */
export const SEARCH_FIELDS: readonly SearchField[] = ["title", "text", "properties", "id"];

/** The fields MiniSearch indexes (words); `id` is compared with the records. */
type WordField = Exclude<SearchField, "id">;
const WORD_FIELDS: readonly WordField[] = ["title", "text", "properties"];

/** One MiniSearch document: an element record, keyed by `docKey`. */
export interface SearchDocument {
  readonly key: string;
  readonly title: string;
  readonly text: string;
  readonly properties: string;
}

/** Splits text into words: at every character that is not a letter, a mark or a digit. */
const WORD_SEPARATOR = /[^\p{L}\p{M}\p{N}]+/u;

/** A word as it is indexed and searched: NFC, lower case; undefined for none. */
const normalizeWord = (word: string): string | undefined => {
  const term = word.normalize("NFC").toLowerCase();
  return term === "" ? undefined : term;
};

const words = (text: string): string[] => text.split(WORD_SEPARATOR);

/**
 * The options of every MiniSearch object of the index, also of one loaded from the cache
 * (`search-cache.ts`): the same fields, tokenizer and term processing. Vacuuming is off and never
 * started: MiniSearch 7.2.0 walks its term tree in batches with a pause between them, and a document
 * added or a search made in a pause (a search cleans up the words of discarded documents it meets)
 * can change the nodes the walk stands on, which then throws in its timer. A carry removes the
 * documents it replaces instead (`carrySearchIndex`), so nothing is left to vacuum.
 */
export const ENGINE_OPTIONS: Options<SearchDocument> = {
  idField: "key",
  fields: [...WORD_FIELDS],
  tokenize: words,
  processTerm: normalizeWord,
  autoVacuum: false,
};

/** The MiniSearch object of an index, shared by the indexes carried from it (see `carrySearchIndex`). */
export interface SearchEngine {
  readonly mini: MiniSearch<SearchDocument>;
  /**
   * The documents in `mini` by key, as they were added, so that a carry can remove them exactly
   * (`MiniSearch.remove`); undefined for an object loaded from the cache, whose documents a carry
   * discards (MiniSearch then drops their words as searches meet them).
   */
  readonly documents: Map<string, SearchDocument> | undefined;
  /** Counts the changes of `mini`; a save of the cache is skipped when it changed meanwhile. */
  generation: number;
}

/** The search index of one element store. */
export interface SearchIndex {
  /** The store it was built from or carried over to. */
  readonly store: ElementStore;
  /** The layout the texts were read with (the repository folders). */
  readonly layout: WorkspaceLayout;
  /** The metamodel it was built with: title key, relation keys, choice names, type prefixes. */
  readonly metamodel: Metamodel;
  /** Every element record of `store` by `docKey`. */
  readonly records: ReadonlyMap<string, ElementRecord>;
  readonly engine: SearchEngine;
}

/** The key of the document of the element in `file` of `repository`. A path never holds NUL. */
export const docKey = (repository: string, file: string): string => `${repository}\0${file}`;

/** The key of the document of `record`. */
export const recordKey = (record: Pick<ElementRecord, "repository" | "file">): string =>
  docKey(record.repository, record.file);

/**
 * The texts of a frontmatter value: text, numbers and booleans, a date (`!!timestamp`) as ISO text,
 * also inside lists, mappings, ordered maps and sets (`!!omap`, `!!set`); binary data (`!!binary`)
 * has none.
 */
const valueTexts = (value: unknown, out: string[]): void => {
  if (typeof value === "string") {
    out.push(value);
  } else if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
  } else if (value instanceof Date) {
    // An invalid date has no text.
    if (!Number.isNaN(value.getTime())) {
      out.push(value.toISOString());
    }
  } else if (Array.isArray(value) || value instanceof Map || value instanceof Set) {
    for (const item of value.values()) {
      valueTexts(item, out);
    }
  } else if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const item of Object.values(value)) {
      valueTexts(item, out);
    }
  }
};

/** The text of the `properties` field of `record` (see the file comment). */
const propertiesText = (
  record: ElementRecord,
  metamodel: Metamodel,
  titleKey: string | undefined,
): string => {
  const out: string[] = [];
  for (const [key, value] of Object.entries(record.data)) {
    if (key === titleKey || STRUCTURAL_KEYS.includes(key) || relationKey(metamodel, key) !== undefined) {
      continue;
    }
    valueTexts(value, out);
    const defined = keyDefinition(metamodel, key);
    const choices = defined?.kind === "property" ? defined.definition.choices : undefined;
    if (choices !== undefined) {
      const chosen = new Set<unknown>(Array.isArray(value) ? value : [value]);
      out.push(...choices.filter((choice) => chosen.has(choice.key)).map((choice) => choice.name));
    }
  }
  return out.join("\n");
};

/** `text` without the destinations of its links and images (see the file comment). */
const visibleText = (text: string): string => {
  let out = "";
  let at = 0;
  for (const { start, end } of markdownLinks(text)) {
    out += text.slice(at, start);
    at = end;
  }
  return out + text.slice(at);
};

/** The document of `record` with the Markdown text `text`. */
export const documentOf = (record: ElementRecord, text: string, metamodel: Metamodel): SearchDocument => {
  const titleKey = titleKeyOf(metamodel);
  const title = titleKey === undefined ? undefined : record.data[titleKey];
  return {
    key: recordKey(record),
    title: typeof title === "string" ? title : "",
    text: visibleText(text),
    properties: propertiesText(record, metamodel, titleKey),
  };
};

/**
 * The document of `record` as its file holds it now: the text of the bytes the store read, or,
 * when the file changed since, the element the file holds now when it still has the record's UUID
 * (as the current versions read it, ADR-0008), else the record without a text. `exact` tells
 * whether it is the record with the text of its snapshot.
 */
const documentNow = (
  layout: WorkspaceLayout,
  record: ElementRecord,
  metamodel: Metamodel,
): { readonly document: SearchDocument; readonly exact: boolean } => {
  const repository = layout.repositories.find((r) => r.name === record.repository);
  if (repository === undefined) {
    return { document: documentOf(record, "", metamodel), exact: false };
  }
  const read = readElementBodySync(repository.folder, record.file, record.snapshot);
  if (read.kind === "same") {
    return { document: documentOf(record, read.body, metamodel), exact: true };
  }
  if (read.read.kind === "parsed") {
    const now = classifyFile(record.repository, read.read.file);
    if (now.kind === "element" && now.element.id === record.id) {
      return {
        document: { ...documentOf(now.element, read.read.file.body, metamodel), key: recordKey(record) },
        exact: false,
      };
    }
  }
  return { document: documentOf(record, "", metamodel), exact: false };
};

/**
 * Blocking work before the event loop gets a turn, in ms. A server builds the index in the
 * background (`warmSearchIndex`); a command that starts meanwhile waits for at most the slice that
 * runs, then the build pauses until no command runs (`BuildControl.paused`). A turn costs the build
 * microseconds.
 */
export const SLICE_MS = 5;

/** Files read at most before the event loop gets a turn. */
const CHUNK = 500;

/** How long a paused build waits before it asks again, in ms (`BuildControl.paused`). */
export const PAUSE_MS = 10;

/** Rejects a build that nobody waits for any more (`buildSearchIndex`). */
export class SearchBuildCancelled extends Error {
  constructor() {
    super("the search index is no longer needed: its workspace was closed or its state reset");
    this.name = "SearchBuildCancelled";
  }
}

/** What a build or a carry asks at every turn of the event loop (`search-state.ts` gives it). */
export interface BuildControl {
  /** True: nobody waits for the result any more, and it stops with `SearchBuildCancelled`. */
  readonly cancelled?: () => boolean;
  /** True: it waits (`PAUSE_MS`, then asks again), so that a command that runs now is not slowed. */
  readonly paused?: () => boolean;
}

/** Waits at a turn of the event loop while `control` pauses; throws once it is cancelled. */
const turn = async (control: BuildControl): Promise<void> => {
  await nextTurn();
  for (;;) {
    if (control.cancelled?.() === true) {
      throw new SearchBuildCancelled();
    }
    if (control.paused?.() !== true) {
      return;
    }
    await delay(PAUSE_MS);
  }
};

/**
 * Reads the documents of `records` in slices of at most `SLICE_MS` and `CHUNK` files with a turn of
 * the event loop between them (`turn`: paused and cancelled by `control`), and gives each to
 * `take`. Resolves with whether every document is exact (`documentNow`).
 */
const readDocuments = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  records: Iterable<ElementRecord>,
  take: (document: SearchDocument) => void,
  control: BuildControl,
): Promise<boolean> => {
  let exact = true;
  let read = 0;
  let since = performance.now();
  for (const record of records) {
    const now = documentNow(layout, record, metamodel);
    exact &&= now.exact;
    take(now.document);
    read += 1;
    if (read >= CHUNK || performance.now() - since >= SLICE_MS) {
      await turn(control);
      read = 0;
      since = performance.now();
    }
  }
  return exact;
};

/** A search index built (`buildSearchIndex`), and whether every text in it is that of its record's snapshot. */
export interface BuiltSearchIndex {
  readonly index: SearchIndex;
  /** False when a file changed since the store read it: the index must not be cached for the store. */
  readonly exact: boolean;
}

/**
 * The index of `store` around `mini`, a MiniSearch object that holds exactly its documents, which
 * `documents` gives by key when they are known (see `SearchEngine.documents`).
 */
export const searchIndexOf = (
  store: ElementStore,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  mini: MiniSearch<SearchDocument>,
  documents?: Map<string, SearchDocument>,
): SearchIndex => ({
  store,
  layout,
  metamodel,
  records: new Map(store.elements.map((record) => [recordKey(record), record])),
  engine: { mini, documents, generation: 0 },
});

/**
 * The search index of `store`: every element file is read again for its text (see the file
 * comment), in slices. `control` is asked at every turn (`BuildControl`): a build waits while a
 * command runs and stops when nobody needs it any more (`searchIndexState`).
 */
export const buildSearchIndex = async (
  store: ElementStore,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  control: BuildControl = {},
): Promise<BuiltSearchIndex> => {
  const mini = new MiniSearch<SearchDocument>(ENGINE_OPTIONS);
  const documents = new Map<string, SearchDocument>();
  const add = (document: SearchDocument): void => {
    mini.add(document);
    documents.set(document.key, document);
  };
  const exact = await readDocuments(layout, metamodel, store.elements, add, control);
  return { index: searchIndexOf(store, layout, metamodel, mini, documents), exact };
};

/** The element record in `file` of `repository` in `repositories`, if the file holds one. */
const recordIn = (
  repositories: ReadonlyMap<string, RepositoryContents>,
  repository: string,
  file: string,
): ElementRecord | undefined => {
  const contribution = repositories.get(repository)?.files.get(file);
  return contribution?.kind === "element" ? contribution.element : undefined;
};

/**
 * The search index of `update.to`, carried over from `index`, the index of `update.from` (a save or
 * a watcher batch, #184): the documents of the changed files (`StoreUpdate.files`) are removed and
 * the files that hold an element now are read again (in slices) and their documents added.
 *
 * Unlike the other carried states, the MiniSearch object is changed, not copied (a copy costs about
 * as much as a build): the index of `update.from` shares it, so a command that still holds that
 * index finds the new documents in it, while its hits name only records of its own store
 * (`searchElements`). The documents of the new files are read before the object is changed, and it
 * is changed in one synchronous step, so a search sees it before or after the change, never in
 * between; carries of one workspace run one after the other (`searchIndexState`).
 *
 * The old documents are removed exactly (`MiniSearch.remove`, with the documents the engine kept),
 * so hits, fields, words and scores are those of a fresh build. An object loaded from the cache
 * knows no documents: there they are discarded, and until a search has met every word of them,
 * scores may be a little lower than a fresh build's, as if they still counted. `control` pauses
 * and cancels the reading as for a build.
 */
export const carrySearchIndex = async (
  index: SearchIndex,
  update: StoreUpdate,
  control: BuildControl = {},
): Promise<SearchIndex> => {
  const repositories = new Map(update.repositories.map((contents) => [contents.repository, contents]));
  const records = new Map(index.records);
  const gone: string[] = [];
  const now: ElementRecord[] = [];
  for (const [repository, files] of update.files) {
    for (const file of files) {
      const key = docKey(repository, file);
      gone.push(key);
      records.delete(key);
      const record = recordIn(repositories, repository, file);
      if (record !== undefined) {
        now.push(record);
        records.set(key, record);
      }
    }
  }
  const documents: SearchDocument[] = [];
  await readDocuments(
    index.layout,
    index.metamodel,
    now,
    (document) => {
      documents.push(document);
    },
    control,
  );
  const { engine } = index;
  const { mini, documents: kept } = engine;
  for (const key of gone) {
    const old = kept?.get(key);
    if (old !== undefined) {
      mini.remove(old);
      kept?.delete(key);
    } else if (mini.has(key)) {
      mini.discard(key);
    }
  }
  mini.addAll(documents);
  for (const document of documents) {
    kept?.set(document.key, document);
  }
  engine.generation += 1;
  return { ...index, store: update.to, records };
};

/** How to search (`searchElements`). */
export interface SearchElementsOptions {
  /** Only these fields; default every field (`SEARCH_FIELDS`). */
  readonly fields?: readonly SearchField[];
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
  /** MiniSearch's relevance of the words (BM25, title counted twice); 0 for a match of the ID only. */
  readonly score: number;
  /** The fields a word of the query was found in, in the order of `SEARCH_FIELDS`. */
  readonly fields: readonly SearchField[];
  /** The words of the element that matched (lower case, NFC), for highlighting; none for an ID. */
  readonly terms: readonly string[];
}

/** The hits of a query: how many there are, and one page of them (`offset`, `limit`). */
export interface SearchResults {
  readonly total: number;
  readonly hits: readonly SearchHit[];
}

/** Letters a word needs for fuzzy search: in a shorter one an edit would find most words. */
export const MIN_FUZZY = 4;
/** Letters a word needs for prefix search. */
export const MIN_PREFIX = 2;

/** Field weights: a match in the title counts twice. */
const BOOST: Readonly<Record<WordField, number>> = { title: 2, text: 1, properties: 1 };

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
 * How one word of a query matches IDs (see the file comment), or undefined when it matches none: a
 * test of a record.
 */
const idMatcher = (word: string, metamodel: Metamodel): ((record: ElementRecord) => boolean) | undefined => {
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

/** A document found: its record, the score of its words and what found it. */
interface Found {
  readonly element: ElementRecord;
  score: number;
  /** MiniSearch's results that found the document; none for an ID only. */
  results: readonly SearchResult[];
  /** Words of the query that matched the ID. */
  ids: number;
}

/** One search: the index, which records count, and MiniSearch's options. */
interface Search {
  readonly index: SearchIndex;
  /** Whether the record of `key` is one of the index's store (and of `within`). */
  readonly admit: (record: ElementRecord | undefined, key: string) => record is ElementRecord;
  readonly options: SearchOptions;
}

/** The search of `options` in `searched` (the fields of words). */
const searchOf = (
  index: SearchIndex,
  searched: readonly WordField[],
  options: SearchElementsOptions,
): Search => {
  const within = options.within === undefined ? undefined : new Set(Array.from(options.within, recordKey));
  const admit = (record: ElementRecord | undefined, key: string): record is ElementRecord =>
    record !== undefined && (within === undefined || within.has(key));
  const fuzzy = options.fuzzy ?? 0.2;
  const prefix = options.prefix ?? true;
  return {
    index,
    admit,
    options: {
      fields: [...searched],
      boost: BOOST,
      fuzzy: (term) => term.length >= MIN_FUZZY && fuzzy,
      prefix: (term) => term.length >= MIN_PREFIX && prefix,
    },
  };
};

/**
 * The documents MiniSearch finds for `queries` (each a word of the user's query, whose parts must
 * all match: `v1.2`), combined with `and` or not, by key. A document whose record is not in this
 * index's store (a carried index shares its MiniSearch object with the next store's,
 * `carrySearchIndex`) is no hit of this index.
 */
const wordsFound = (search: Search, queries: readonly string[], and: boolean): Map<string, Found> => {
  const query: Query = {
    queries: queries.map((word) => ({ queries: [word], combineWith: "AND" })),
    combineWith: and ? "AND" : "OR",
  };
  const found = new Map<string, Found>();
  for (const result of search.index.engine.mini.search(query, search.options)) {
    const key = String(result.id);
    const element = search.index.records.get(key);
    if (search.admit(element, key)) {
      found.set(key, { element, score: result.score, results: [result], ids: 0 });
    }
  }
  return found;
};

/** Marks in `found` (and adds to it) every record of the index that `ids` matches. */
const idsFound = (
  search: Search,
  ids: (record: ElementRecord) => boolean,
  found: Map<string, Found>,
): void => {
  for (const record of search.index.store.elements) {
    const key = ids(record) ? recordKey(record) : undefined;
    if (key !== undefined && search.admit(record, key)) {
      const known = found.get(key);
      if (known === undefined) {
        found.set(key, { element: record, score: 0, results: [], ids: 1 });
      } else {
        known.ids = 1;
      }
    }
  }
};

/** `a` and `b` combined: the documents of both (`and`) or of either (`or`); scores add up. */
const combine = (a: Map<string, Found>, b: ReadonlyMap<string, Found>, and: boolean): Map<string, Found> => {
  const out = new Map<string, Found>();
  for (const [key, found] of a) {
    const other = b.get(key);
    if (other !== undefined) {
      out.set(key, {
        element: found.element,
        score: found.score + other.score,
        results: [...found.results, ...other.results],
        ids: found.ids + other.ids,
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

/** The position of every record of a store in store order, built once per store. */
const ranks = new WeakMap<ElementStore, ReadonlyMap<ElementRecord, number>>();

const rankOf = (store: ElementStore): ReadonlyMap<ElementRecord, number> => {
  let rank = ranks.get(store);
  if (rank === undefined) {
    rank = new Map(store.elements.map((record, at) => [record, at]));
    ranks.set(store, rank);
  }
  return rank;
};

/** The hit of one document: fields in the order of `SEARCH_FIELDS`, the words that matched. */
const hitOf = ({ element, score, results, ids }: Found): SearchHit => {
  const fields = new Set<string>(ids > 0 ? ["id"] : []);
  const terms = new Set<string>();
  for (const result of results) {
    for (const [term, found] of Object.entries(result.match)) {
      terms.add(term);
      for (const field of found) {
        fields.add(field);
      }
    }
  }
  return { element, score, fields: SEARCH_FIELDS.filter((field) => fields.has(field)), terms: [...terms] };
};

/** The page of `found`, the best first (see `searchElements`). */
const pageOf = (
  store: ElementStore,
  found: Iterable<Found>,
  options: SearchElementsOptions,
): SearchResults => {
  const rank = rankOf(store);
  const sorted = [...found].sort(
    (a, b) => b.ids - a.ids || b.score - a.score || Number(rank.get(a.element)) - Number(rank.get(b.element)),
  );
  const offset = options.offset ?? 0;
  const page = sorted.slice(offset, options.limit === undefined ? undefined : offset + options.limit);
  return { total: sorted.length, hits: page.map(hitOf) };
};

/**
 * The elements of `index` that `query` finds, the best first: each word of the query (split at
 * white space) is searched in the words of the fields (fuzzy, prefix) and compared with the IDs;
 * the words are combined with `options.combineWith`. Elements whose ID a word matched come first
 * (by the number of such words), then by score; equal ones keep store order. A word that can match
 * nothing in `options.fields` (punctuation only, or no ID form with only `id`) is left out; a query
 * without a word finds nothing. Only the page (`offset`, `limit`) is described (`fields`, `terms`).
 *
 * The words without an ID form go to MiniSearch in one query (it combines them before it builds a
 * result per document, which costs most at 50,000 elements); a word that may be an ID is searched
 * on its own and joined with the elements whose ID it matches.
 */
export const searchElements = (
  index: SearchIndex,
  query: string,
  options: SearchElementsOptions = {},
): SearchResults => {
  const fields = new Set(options.fields ?? SEARCH_FIELDS);
  const searched = WORD_FIELDS.filter((field) => fields.has(field));
  const and = options.combineWith !== "or";
  const search = searchOf(index, searched, options);
  const plain: string[] = [];
  const special: {
    readonly word: string;
    readonly text: boolean;
    readonly ids: (r: ElementRecord) => boolean;
  }[] = [];
  for (const word of query.split(/\s+/u)) {
    const text = searched.length > 0 && words(word).some((w) => normalizeWord(w) !== undefined);
    const ids = fields.has("id") ? idMatcher(word, index.metamodel) : undefined;
    if (ids !== undefined) {
      special.push({ word, text, ids });
    } else if (text) {
      plain.push(word);
    }
  }
  let found = plain.length === 0 ? undefined : wordsFound(search, plain, and);
  for (const { word, text, ids } of special) {
    const matched = text ? wordsFound(search, [word], true) : new Map<string, Found>();
    idsFound(search, ids, matched);
    found = found === undefined ? matched : combine(found, matched, and);
  }
  return pageOf(index.store, found?.values() ?? [], options);
};
