// Building and carrying the search index of an element store (ADR-0008 "Search"): the MiniSearch
// documents of the element records, the build in slices, the carry over a change of the store, and
// what an index builds once for its searches (`prepareSearchIndex`). What a document holds and why
// is the file comment of `search-index.ts`, which "the file comment" below means; `search-index.ts`
// exports this module's API, so importers use that module.
import { isCriterionMapping } from "../model/criterion-items.js";
import { setTimeout as delay, setImmediate as nextTurn } from "node:timers/promises";
import MiniSearch from "minisearch";
import type { Options } from "minisearch";
import { readElementBodySync } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, RepositoryContents } from "../model/index.js";
import { classifyFile, relationKey, titleKeyOf } from "../model/index.js";
import { identifierKeyOf, identifierMatch, identifierValue } from "../model/identifier-index.js";
import { PatchedMap } from "../model/patched-map.js";
import type { StoreUpdate } from "../model/store.js";
import { WORD_SEPARATOR, normalizeWord, visibleText } from "./phrase-text.js";
import type { DesignationTable } from "./search-designations.js";
import { designationTable } from "./search-designations.js";
import { buildVocabulary, carryVocabulary, newWords, vocabularyOf } from "./search-vocabulary.js";
import type { KeyedRecords } from "./search-criteria.js";
import { carryKeyed, keyedRecords } from "./search-criteria.js";
import { carryLengths, documentKeys, lengthsOf, nextShortId, shortIdOfDocument } from "./search-scoring.js";
import type { WorkspaceLayout } from "../workspace/index.js";

/** What a hit was found in. */
export type SearchField = "title" | "text" | "properties" | "id";

/** Every field, in the order hits name them. */
export const SEARCH_FIELDS: readonly SearchField[] = ["title", "text", "properties", "id"];

/** The fields MiniSearch indexes (words); `id` is compared with the records. */
export type WordField = Exclude<SearchField, "id">;
export const WORD_FIELDS: readonly WordField[] = ["title", "text", "properties"];

/**
 * One MiniSearch document: an element record, keyed by `docKey`. `parts` holds the texts of the
 * `properties` field per key, flat: `[key1, text1, key2, text2, ...]` in frontmatter order, a key
 * only when it has a text; the fields are taken from it (`extractField`).
 */
export interface SearchDocument {
  readonly key: string;
  readonly title: string;
  readonly text: string;
  readonly parts: readonly string[];
}

/** The prefix of the field of a single property (`propertyField`). */
export const PROPERTY_FIELD = "property:";

/** The MiniSearch field of the property `key` (see the file comment). */
export const propertyField = (key: string): string => `${PROPERTY_FIELD}${key}`;

/** The MiniSearch fields of the type and status names (see the file comment), after every other one. */
export const NAMED_FIELDS: readonly string[] = ["type", "status"];

/** `properties` holds the names of `NAMED_FIELDS` among its other texts (`ScoringOptions.named`). */
export const NAMED = { in: "properties", fields: NAMED_FIELDS } as const;

/**
 * Keys that never get a field of their own: those of the fixed fields, which always mean the fixed
 * field, and type and status, which are found in `properties` by their names.
 */
const FIXED_KEYS: ReadonlySet<string> = new Set([...SEARCH_FIELDS, "type", "status"]);

const propertyKeysCache = new WeakMap<Metamodel, readonly string[]>();

/**
 * The keys of the properties a search can be restricted to one by one (SR-216 AK2), in metamodel
 * order: every property that holds no relations and is not the title, without the keys of
 * `FIXED_KEYS`. Each has the field `propertyField(key)`.
 */
export const searchPropertyKeys = (metamodel: Metamodel): readonly string[] => {
  let keys = propertyKeysCache.get(metamodel);
  if (keys === undefined) {
    const titleKey = titleKeyOf(metamodel);
    keys = metamodel.properties
      .filter(
        ({ key, kind }) =>
          kind !== "relation" &&
          key !== titleKey &&
          !FIXED_KEYS.has(key) &&
          relationKey(metamodel, key) === undefined,
      )
      .map(({ key }) => key);
    propertyKeysCache.set(metamodel, keys);
  }
  return keys;
};

/** The text of the `properties` field of a document: the texts of its parts, one per line. */
const propertiesOf = (parts: readonly string[]): string => {
  let out = "";
  for (let at = 1; at < parts.length; at += 2) {
    out += at === 1 ? String(parts[at]) : `\n${String(parts[at])}`;
  }
  return out;
};

/** The text of the key `key` in `parts`; empty when the document has none (see the file comment). */
const partOf = (parts: readonly string[], key: string): string => {
  for (let at = 0; at < parts.length; at += 2) {
    if (parts[at] === key) {
      return String(parts[at + 1]);
    }
  }
  return "";
};

/** The value of `field` of `document`, as MiniSearch reads it (`Options.extractField`). */
const extractField = (document: SearchDocument, field: string): string => {
  switch (field) {
    case "key":
      return document.key;
    case "title":
      return document.title;
    case "text":
      return document.text;
    case "properties":
      return propertiesOf(document.parts);
    case "type":
    case "status":
      return partOf(document.parts, field);
    default:
      return partOf(document.parts, field.slice(PROPERTY_FIELD.length));
  }
};

const words = (text: string): string[] => text.split(WORD_SEPARATOR);

/**
 * The options of a MiniSearch object with the fields of the properties `propertyKeys` besides
 * `WORD_FIELDS` (see the file comment): the tokenizer, the term processing and `extractField`.
 * Vacuuming is off and never started: MiniSearch 7.2.0 walks its term tree in batches with a pause
 * between them, and a document added or a search made in a pause (a search cleans up the words of
 * discarded documents it meets) can change the nodes the walk stands on, which then throws in its
 * timer. A carry removes the documents it replaces instead (`carrySearchIndex`), so nothing is left
 * to vacuum.
 */
export const engineOptionsFor = (propertyKeys: readonly string[]): Options<SearchDocument> => ({
  idField: "key",
  fields: [...WORD_FIELDS, ...propertyKeys.map(propertyField), ...NAMED_FIELDS],
  extractField,
  tokenize: words,
  processTerm: normalizeWord,
  autoVacuum: false,
});

const engineOptionsCache = new WeakMap<Metamodel, Options<SearchDocument>>();

/**
 * The options of every MiniSearch object of an index built with `metamodel`, also of one loaded from
 * the cache (`search-cache.ts`): `engineOptionsFor` its `searchPropertyKeys`.
 */
export const engineOptions = (metamodel: Metamodel): Options<SearchDocument> => {
  let options = engineOptionsCache.get(metamodel);
  if (options === undefined) {
    options = engineOptionsFor(searchPropertyKeys(metamodel));
    engineOptionsCache.set(metamodel, options);
  }
  return options;
};

/** The MiniSearch object of an index, shared by the indexes carried from it (see `carrySearchIndex`). */
export interface SearchEngine {
  readonly mini: MiniSearch<SearchDocument>;
  /**
   * The documents in `mini` by key, as they were added: a carry removes them exactly
   * (`MiniSearch.remove`), and a phrase is looked for in their texts (SR-068 AK4). An object loaded
   * from the cache has them too (`search-cache.ts`).
   */
  readonly documents: Map<string, SearchDocument>;
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
 * has none, and an acceptance criterion with its key only its text.
 */
export const valueTexts = (value: unknown, out: string[]): void => {
  if (isCriterionMapping(value)) {
    // An acceptance criterion with its key: its text only, the key is no word (SR-204).
    out.push(value.text);
  } else if (typeof value === "string") {
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

/**
 * The name the tool shows for the type or status `value` (`key`), when the metamodel defines it (see
 * the file comment).
 */
const structuralName = (metamodel: Metamodel, key: string, value: unknown): string | undefined =>
  key === "type"
    ? findType(metamodel, String(value))?.name
    : metamodel.statuses.find((status) => status.key === value)?.name;

/** The names of the choices of the property `key` that `value` holds; none for another property. */
const choiceNames = (metamodel: Metamodel, key: string, value: unknown): readonly string[] => {
  const defined = keyDefinition(metamodel, key);
  const choices = defined?.kind === "property" ? defined.definition.choices : undefined;
  if (choices === undefined) {
    return [];
  }
  const chosen = new Set<unknown>(Array.isArray(value) ? value : [value]);
  return choices.filter((choice) => chosen.has(choice.key)).map((choice) => choice.name);
};

/**
 * The texts the `properties` field holds of the key `key` with `value` (see the file comment), one
 * per value; none for the title, `id` and the keys that hold relations.
 */
export const keyTexts = (
  metamodel: Metamodel,
  titleKey: string | undefined,
  key: string,
  value: unknown,
): string[] => {
  const out: string[] = [];
  if (key === titleKey || key === "id" || relationKey(metamodel, key) !== undefined) {
    return out;
  }
  if (key === "type" || key === "status") {
    valueTexts(structuralName(metamodel, key, value) ?? value, out);
  } else {
    valueTexts(value, out);
    out.push(...choiceNames(metamodel, key, value));
  }
  return out;
};

/**
 * The parts of the `properties` field of `record` (`SearchDocument.parts`, see the file comment):
 * per key its texts, one per line; a key without a text adds none, so the field is the texts of
 * every key one per line, as before it had parts.
 */
const propertyParts = (
  record: ElementRecord,
  metamodel: Metamodel,
  titleKey: string | undefined,
): string[] => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record.data)) {
    const out = keyTexts(metamodel, titleKey, key, value);
    if (out.length > 0) {
      parts.push(key, out.join("\n"));
    }
  }
  return parts;
};

/** The text of the `properties` field of `document` (see the file comment). */
export const propertiesText = (document: SearchDocument): string => propertiesOf(document.parts);

/**
 * The document of `record` whose text is `text` as the document holds it (`visibleText`): the cache
 * keeps only that text (`search-cache.ts`).
 */
export const documentWithText = (
  record: ElementRecord,
  text: string,
  metamodel: Metamodel,
): SearchDocument => {
  const titleKey = titleKeyOf(metamodel);
  const title = titleKey === undefined ? undefined : record.data[titleKey];
  return {
    key: recordKey(record),
    title: typeof title === "string" ? title : "",
    text,
    parts: propertyParts(record, metamodel, titleKey),
  };
};

/** The document of `record` with the Markdown text `text`. */
export const documentOf = (record: ElementRecord, text: string, metamodel: Metamodel): SearchDocument =>
  documentWithText(record, visibleText(text), metamodel);

/** An element as its file holds it now, with its Markdown text (`elementNow`). */
export interface ElementNow {
  /** The record itself when the file is unchanged, else the element the file holds now. */
  readonly element: ElementRecord;
  readonly body: string;
}

/**
 * The element of `record` as its file holds it now (in `layout`, by repository and file, SR-088):
 * the record with the text of the bytes the store read, or, when the file changed since, the
 * element the file holds now when it still has the record's UUID (as the current versions read it,
 * ADR-0008); undefined otherwise. Blocking reads, so a caller can use it in the turn it searches in.
 */
export const elementNow = (layout: WorkspaceLayout, record: ElementRecord): ElementNow | undefined => {
  const repository = layout.repositories.find((r) => r.name === record.repository);
  if (repository === undefined) {
    return undefined;
  }
  const read = readElementBodySync(repository.folder, record.file, record.snapshot);
  if (read.kind === "same") {
    return { element: record, body: read.body };
  }
  if (read.read.kind === "parsed") {
    const now = classifyFile(record.repository, read.read.file);
    if (now.kind === "element" && now.element.id === record.id) {
      return { element: now.element, body: read.read.file.body };
    }
  }
  return undefined;
};

/**
 * The document of `record` as its file holds it now (`elementNow`), else the record without a text.
 * `exact` tells whether it is the record with the text of its snapshot.
 */
const documentNow = (
  layout: WorkspaceLayout,
  record: ElementRecord,
  metamodel: Metamodel,
): { readonly document: SearchDocument; readonly exact: boolean } => {
  const now = elementNow(layout, record);
  if (now === undefined) {
    return { document: documentOf(record, "", metamodel), exact: false };
  }
  return {
    document: { ...documentOf(now.element, now.body, metamodel), key: recordKey(record) },
    exact: now.element === record,
  };
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
 * The index of `store` around `mini`, a MiniSearch object that holds exactly `documents`, by key as
 * they were added (see `SearchEngine.documents`).
 */
export const searchIndexOf = (
  store: ElementStore,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  mini: MiniSearch<SearchDocument>,
  documents: Map<string, SearchDocument>,
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
  const mini = new MiniSearch<SearchDocument>(engineOptions(metamodel));
  const documents = new Map<string, SearchDocument>();
  const add = (document: SearchDocument): void => {
    mini.add(document);
    documents.set(document.key, document);
  };
  const exact = await readDocuments(layout, metamodel, store.elements, add, control);
  // The words for word parts (SR-221), in slices as the documents were read.
  await buildVocabulary(mini, 0, SLICE_MS, () => turn(control));
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
 * a watcher batch, ThomasBirkmaier/ReqSeq-archive#184): the documents of the changed files (`StoreUpdate.files`) are removed and
 * the files that hold an element now are read again (in slices) and their documents added.
 *
 * Unlike the other carried states, the MiniSearch object is changed, not copied (a copy costs about
 * as much as a build): the index of `update.from` shares it, so a command that still holds that
 * index finds the new documents in it, while its hits name only records of its own store
 * (`searchElements`). The documents of the new files are read before the object is changed, and it
 * is changed in one synchronous step, so a search sees it before or after the change, never in
 * between; carries of one workspace run one after the other (`searchIndexState`).
 *
 * The old documents are removed exactly (`MiniSearch.remove`, with the documents the engine kept,
 * also one loaded from the cache), so hits, fields, words and scores are those of a fresh build.
 * `control` pauses and cancels the reading as for a build.
 */
export const carrySearchIndex = async (
  index: SearchIndex,
  update: StoreUpdate,
  control: BuildControl = {},
): Promise<SearchIndex> => {
  const repositories = new Map(update.repositories.map((contents) => [contents.repository, contents]));
  const changes = new Map<string, ElementRecord | undefined>();
  const gone: string[] = [];
  const now: ElementRecord[] = [];
  for (const [repository, files] of update.files) {
    for (const file of files) {
      const key = docKey(repository, file);
      gone.push(key);
      const record = recordIn(repositories, repository, file);
      changes.set(key, record);
      if (record !== undefined) {
        now.push(record);
      }
    }
  }
  // A patch of the records before (`PatchedMap`, #215), not a copy of 50,000 keys.
  const records = PatchedMap.patch(index.records, changes);
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
  // MiniSearch's short IDs of the documents removed and added, for the arrays (`carryArrays`).
  const removed: number[] = [];
  // The words the tree does not hold yet, before the old documents leave it (SR-221, `carryVocabulary`).
  const words = newWords(mini, documents);
  try {
    for (const key of gone) {
      const old = kept.get(key);
      if (old !== undefined) {
        removed.push(Number(shortIdOfDocument(mini, key)));
        mini.remove(old);
        kept.delete(key);
      }
    }
    mini.addAll(documents);
    for (const document of documents) {
      kept.set(document.key, document);
    }
  } finally {
    // Also after a throw halfway: the caches of the arrays (`documentsOf`, `lengthsOf`) must not
    // be taken for the object as it now is.
    engine.generation += 1;
  }
  carryVocabulary(mini, engine.generation, words);
  const carried: SearchIndex = { ...index, store: update.to, records };
  const added = documents.map((document) => Number(shortIdOfDocument(mini, document.key)));
  carryArrays(index, carried, removed, added);
  carryIdentified(index, carried, gone, now);
  carryKeys(index, carried, gone, now);
  return prepareSearchIndex(carried);
};

/** The records of every index with an identifier, by its `identifierMatch`, built on first use. */
const identified = new WeakMap<SearchIndex, ReadonlyMap<string, ReadonlySet<ElementRecord>>>();

export const identifiedIn = (index: SearchIndex): ReadonlyMap<string, ReadonlySet<ElementRecord>> => {
  let known = identified.get(index);
  if (known === undefined) {
    const key = identifierKeyOf(index.metamodel);
    const built = new Map<string, Set<ElementRecord>>();
    for (const record of key === undefined ? [] : index.store.elements) {
      const value = identifierValue(record, key);
      if (value !== undefined) {
        const match = identifierMatch(value);
        const records = built.get(match) ?? new Set();
        records.add(record);
        built.set(match, records);
      }
    }
    identified.set(index, built);
    known = built;
  }
  return known;
};

/**
 * The records by identifier of `carried`, from those of `index` when they were built (#215): only
 * the identifiers of the records of the changed files (the documents `gone` before, the records
 * `now` after) are looked at; a patch of the map, whose sets of other identifiers stay the same
 * objects. Otherwise they are built in full at the end of the carry (`prepareSearchIndex`).
 */
const carryIdentified = (
  index: SearchIndex,
  carried: SearchIndex,
  gone: readonly string[],
  now: readonly ElementRecord[],
): void => {
  const known = identified.get(index);
  const key = identifierKeyOf(index.metamodel);
  if (known === undefined || key === undefined) {
    return;
  }
  const changes = new Map<string, Set<ElementRecord> | undefined>();
  const setOf = (match: string): Set<ElementRecord> => {
    let set = changes.get(match);
    if (set === undefined) {
      set = new Set(known.get(match));
      changes.set(match, set);
    }
    return set;
  };
  for (const record of gone.flatMap((at) => index.records.get(at) ?? [])) {
    const value = identifierValue(record, key);
    if (value !== undefined) {
      setOf(identifierMatch(value)).delete(record);
    }
  }
  for (const record of now) {
    const value = identifierValue(record, key);
    if (value !== undefined) {
      setOf(identifierMatch(value)).add(record);
    }
  }
  for (const [match, set] of changes) {
    if (set?.size === 0) {
      changes.set(match, undefined);
    }
  }
  identified.set(carried, PatchedMap.patch(known, changes));
};

/** The table of other designations of every index (SR-220), built on first use; null for none. */
const designationTables = new WeakMap<SearchIndex, DesignationTable | null>();

/**
 * The table of other designations of `index` (`designationTable` of `search-designations.ts`): of the
 * records of its store, so a carried index, which has the store after a save or a watcher batch,
 * has its own (SR-220 AK4); undefined when its metamodel maps no designations or none has another.
 */
export const designationsIn = (index: SearchIndex): DesignationTable | undefined => {
  let table = designationTables.get(index);
  if (table === undefined) {
    table = designationTable(index.store.elements, index.metamodel) ?? null;
    designationTables.set(index, table);
  }
  return table ?? undefined;
};

/** The records of every index by criterion key (SR-222, `keyedRecords`), built on first use. */
const keyedIndexes = new WeakMap<SearchIndex, KeyedRecords>();

export const keyedIn = (index: SearchIndex): KeyedRecords => {
  let known = keyedIndexes.get(index);
  if (known === undefined) {
    known = keyedRecords(index.store, index.metamodel, recordKey);
    keyedIndexes.set(index, known);
  }
  return known;
};

/**
 * The records by criterion key of `carried`, from those of `index` when they were built, as
 * `carryIdentified` carries the identifiers; otherwise built at the end of the carry.
 */
const carryKeys = (
  index: SearchIndex,
  carried: SearchIndex,
  gone: readonly string[],
  now: readonly ElementRecord[],
): void => {
  const known = keyedIndexes.get(index);
  if (known !== undefined) {
    const before = gone.flatMap((at) => index.records.get(at) ?? []);
    keyedIndexes.set(carried, carryKeyed(known, index.metamodel, before, now, recordKey));
  }
};

/**
 * The place of each repository of the workspace file in store order (the store is ordered by
 * repository in that order, then by file path), per layout: hits of equal score are ordered by
 * repository and path (`before`), which needs no position of every record, so a carry builds none
 * (#215).
 */
const repositoryPlaces = new WeakMap<WorkspaceLayout, ReadonlyMap<string, number>>();

const placesOf = (layout: WorkspaceLayout): ReadonlyMap<string, number> => {
  let places = repositoryPlaces.get(layout);
  if (places === undefined) {
    places = new Map(layout.repositories.map((repository, at) => [repository.name, at]));
    repositoryPlaces.set(layout, places);
  }
  return places;
};

/** The place of the repository of a record in `layout` (`placesOf`); after every other one when it lists none. */
export const placeIn = (layout: WorkspaceLayout): ((record: Pick<ElementRecord, "repository">) => number) => {
  const places = placesOf(layout);
  return (record) => places.get(record.repository) ?? places.size;
};

/** The records, keys and repository places (`placesOf`) of the documents of an index, by MiniSearch's short ID. */
interface Documents {
  readonly generation: number;
  readonly records: readonly (ElementRecord | undefined)[];
  readonly keys: readonly (string | undefined)[];
  readonly places: Int32Array;
  /** The documents the engine keeps (`SearchEngine.documents`), for a phrase (`phraseFound`). */
  readonly documents: readonly (SearchDocument | undefined)[];
}

const documentsCache = new WeakMap<SearchIndex, Documents>();

/**
 * The `Documents` of `index` as its MiniSearch object is now (`SearchEngine.generation`): built
 * once per index and change, so that a search looks a document up in arrays, not in maps of
 * 50,000 keys (SR-098). A document whose record is not in the index's store has none.
 */
export const documentsOf = (index: SearchIndex): Documents => {
  const { mini, generation } = index.engine;
  const known = documentsCache.get(index);
  if (known?.generation === generation) {
    return known;
  }
  const placeOf = placeIn(index.layout);
  const records: (ElementRecord | undefined)[] = [];
  const keys: (string | undefined)[] = [];
  const documents: (SearchDocument | undefined)[] = [];
  const places = new Int32Array(nextShortId(mini));
  for (const [doc, key] of documentKeys(mini)) {
    const record = index.records.get(String(key));
    if (record !== undefined) {
      records[doc] = record;
      keys[doc] = String(key);
      places[doc] = placeOf(record);
      documents[doc] = index.engine.documents.get(String(key));
    }
  }
  const built = { generation, records, keys, places, documents };
  documentsCache.set(index, built);
  return built;
};

/**
 * The arrays of `carried` (its `Documents` and the field lengths of its MiniSearch object) after a
 * carry from `index` that removed the documents `removed` and added `added` (MiniSearch's short
 * IDs), derived from those of `index` when they were built for the change before (#215): copies
 * with only these documents changed. Otherwise they are built in full at the end of the carry
 * (`prepareSearchIndex`).
 */
const carryArrays = (
  index: SearchIndex,
  carried: SearchIndex,
  removed: readonly number[],
  added: readonly number[],
): void => {
  const { mini, generation } = carried.engine;
  carryLengths(mini, generation, removed, added);
  const known = documentsCache.get(index);
  if (known?.generation !== generation - 1) {
    return;
  }
  const records = [...known.records];
  const keys = [...known.keys];
  const documents = [...known.documents];
  const places = new Int32Array(nextShortId(mini));
  places.set(known.places);
  const placeOf = placeIn(carried.layout);
  // No search reads a removed short ID (MiniSearch's words no longer name it); cleared anyway, so
  // the arrays hold no record that left the store. They grow by one slot per added document, as
  // MiniSearch's short IDs do (`nextShortId`), and so did a fresh `documentsOf`.
  for (const doc of removed) {
    records[doc] = undefined;
    keys[doc] = undefined;
    documents[doc] = undefined;
  }
  for (const doc of added) {
    const key = String(documentKeys(mini).get(doc));
    const record = carried.records.get(key);
    records[doc] = record;
    keys[doc] = key;
    documents[doc] = carried.engine.documents.get(key);
    /* v8 ignore else -- an added document holds the record of its key (`carrySearchIndex`). */
    if (record !== undefined) {
      places[doc] = placeOf(record);
    }
  }
  documentsCache.set(carried, { generation, records, keys, places, documents });
};

/**
 * Builds what the first search of `index` builds otherwise: the arrays of its documents
 * (`documentsOf`, `lengthsOf`), the records by identifier (`identifiedIn`), the table of other
 * designations (`designationsIn`) and the words for word parts (`vocabularyOf`, SR-221: built with
 * the index and carried, so walked here only when a carry outgrew it), so that it costs no
 * more than the next ones (SR-098: 165 to 320 ms instead of 45 ms at N-036). A server does it at the
 * end of its background build (`warmSearchIndex`), a carry at its end; returns `index`.
 */
export const prepareSearchIndex = (index: SearchIndex): SearchIndex => {
  identifiedIn(index);
  keyedIn(index);
  designationsIn(index);
  documentsOf(index);
  lengthsOf(index.engine.mini, index.engine.generation);
  vocabularyOf(index.engine.mini, index.engine.generation);
  return index;
};
