// The search index in the cache folder of a working copy (ADR-0008 "Cache"): `search.json` holds
// the serialised MiniSearch object of the index of one element store, with a digest of the file
// entries it was built from. Unlike the model cache, it is trusted only as a whole: a process uses
// it only when the store it loaded has the same digest, never document by document, since a
// document cannot be checked against its file without reading the file (which is the build). It
// serves a process that needs the index at once (a one-shot CLI command); a server builds the
// index in the background instead (`searchIndexState`), since loading it blocks the thread.
import { createHash } from "node:crypto";
import MiniSearch from "minisearch";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementStore } from "../model/index.js";
import { relationKey, titleKeyOf } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { readCacheFile, writeCacheFile } from "../workspace/index.js";
import type { SearchDocument, SearchIndex } from "./search-index.js";
import { ENGINE_OPTIONS, recordKey, searchIndexOf } from "./search-index.js";

/** The name of the search index in the cache folder of a copy (`cacheFolder(root)`). */
export const SEARCH_CACHE_FILE = "search.json";

/** The format of `search.json`; a file of another format is not used. */
export const SEARCH_CACHE_FORMAT = 1;

/**
 * What of the metamodel decides the documents (`documentOf`): the title key, the keys that hold
 * relations (left out) and the names of the choices.
 */
const metamodelPart = (metamodel: Metamodel): unknown => ({
  title: titleKeyOf(metamodel) ?? null,
  relations: [...new Set([...metamodel.properties, ...metamodel.relations].map((d) => d.key))]
    .filter((key) => relationKey(metamodel, key) !== undefined)
    .sort(),
  choices: metamodel.properties.map((p) => [p.key, (p.choices ?? []).map((c) => [c.key, c.name])]),
});

/**
 * The digest of what the search index of `store` with `metamodel` is built from: per element record
 * in store order its repository, file and the SHA-256 of its bytes (`FileSnapshot`), and the part
 * of the metamodel that decides the documents. Equal digests mean equal documents: the text, the
 * frontmatter and the UUID of a record all come from those bytes.
 */
export const searchDigest = (store: ElementStore, metamodel: Metamodel): string => {
  const hash = createHash("sha256").update(`${JSON.stringify(metamodelPart(metamodel))}\n`);
  for (const { repository, file, snapshot } of store.elements) {
    hash.update(`${repository}\0${file}\0${snapshot.sha256}\n`);
  }
  return hash.digest("hex");
};

/** The header line of `search.json`. */
interface Header {
  readonly format: number;
  readonly code: string;
  readonly root: string;
  readonly digest: string;
}

/** What a process expects of the header: the fingerprint of core's code, the canonical root, the digest. */
export type ExpectedHeader = Omit<Header, "format">;

/**
 * `search.json` for `index`: a header line (format, fingerprint of core's code, canonical root and
 * digest), then the MiniSearch object as JSON. The header comes first so that a process refuses
 * the file before it parses the index.
 */
export const serializeSearchIndex = (index: SearchIndex, expected: ExpectedHeader): string => {
  const header: Header = { format: SEARCH_CACHE_FORMAT, ...expected };
  return `${JSON.stringify(header)}\n${JSON.stringify(index.engine.mini)}\n`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `header` is the one a process expects. */
const fits = (header: unknown, expected: ExpectedHeader): boolean =>
  isRecord(header) &&
  header["format"] === SEARCH_CACHE_FORMAT &&
  header["code"] === expected.code &&
  header["root"] === expected.root &&
  header["digest"] === expected.digest;

/**
 * The search index of `store` from `text`, the contents of `search.json`, or undefined when it is
 * not one for it: another format, code, root or digest, not an index MiniSearch loads, or not one
 * document for every record of the store.
 */
export const parseSearchIndex = (
  text: string,
  expected: ExpectedHeader,
  store: ElementStore,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
): SearchIndex | undefined => {
  const end = text.indexOf("\n");
  let mini: MiniSearch<SearchDocument>;
  try {
    if (!fits(JSON.parse(text.slice(0, end)), expected)) {
      return undefined;
    }
    mini = MiniSearch.loadJSON<SearchDocument>(text.slice(end + 1), ENGINE_OPTIONS);
  } catch {
    return undefined;
  }
  const whole =
    mini.documentCount === store.elements.length &&
    store.elements.every((record) => mini.has(recordKey(record)));
  return whole ? searchIndexOf(store, layout, metamodel, mini) : undefined;
};

/** Reads the search index of `store` from the cache `folder`; undefined when there is none for it. */
export const readSearchCache = async (
  folder: string,
  expected: ExpectedHeader,
  store: ElementStore,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
): Promise<SearchIndex | undefined> => {
  let text: string | undefined;
  try {
    text = await readCacheFile(folder, SEARCH_CACHE_FILE);
  } catch {
    return undefined;
  }
  return text === undefined ? undefined : parseSearchIndex(text, expected, store, layout, metamodel);
};

/**
 * Writes `search.json` for `index` (built for `expected.digest`), unless its MiniSearch object
 * changed since it was built (a carry: then it no longer holds the documents of that digest). A
 * failure is ignored, since the cache only saves time.
 */
export const saveSearchCache = async (
  folder: string,
  expected: ExpectedHeader,
  index: SearchIndex,
): Promise<void> => {
  if (index.engine.generation !== 0) {
    return;
  }
  try {
    await writeCacheFile(folder, SEARCH_CACHE_FILE, serializeSearchIndex(index, expected));
  } catch {
    // A folder that cannot be written (read-only, full): the next process builds the index again.
  }
};
