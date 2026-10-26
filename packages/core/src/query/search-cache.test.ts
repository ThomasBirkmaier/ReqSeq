import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import MiniSearch from "minisearch";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementStore } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import { codeFingerprint } from "../model/model-cache.js";
import { updateElement } from "../model/write.js";
import { Workspace } from "../runtime/workspace.js";
import { canonicalRoot, workspaceLayoutState } from "../workspace/index.js";
import type { ExpectedHeader } from "./search-cache.js";
import {
  SEARCH_CACHE_FILE,
  SEARCH_CACHE_FORMAT,
  parseSearchIndex,
  readSearchCache,
  saveSearchCache,
  searchDigest,
  serializeSearchIndex,
} from "./search-cache.js";
import type { SearchDocument, SearchIndex } from "./search-index.js";
import {
  ENGINE_OPTIONS,
  buildSearchIndex,
  documentOf,
  searchElements,
  searchIndexOf,
} from "./search-index.js";
import { searchIndex, searchIndexState, warmSearchIndex } from "./search-state.js";

const N1 = "6adc6d88-2177-457b-959d-545b7b379da2";
const S1 = "0b0e6f6c-3c1f-4c55-9d0e-0c1d2e3f4a5b";

const WORKSPACE =
  "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n";

const element = (id: string, type: string, title: string, text: string): string =>
  `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: ${title}\n---\n${text}\n`;

const FILES: Readonly<Record<string, string>> = {
  "logreq-workspace.yaml": WORKSPACE,
  "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  "needs/N-545b7b379da2.md": element(N1, "need", "Wind speed", "Gusts and squalls."),
  "requirements/SR-0c1d2e3f4a5b.md": element(S1, "system-requirement", "Air pressure", "Barometer."),
};

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ files: FILES });
  onTestFinished(() => created.cleanup());
  return created;
};

const tempFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-search-cache-")));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
};

const opened = (root: string, cacheFolder?: string): Workspace => {
  const workspace = new Workspace(root, cacheFolder === undefined ? {} : { cacheFolder });
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The index of a workspace without a cache, with what the cache of its store expects. */
const built = async (
  ws: FixtureWorkspace,
): Promise<{ index: SearchIndex; expected: ExpectedHeader; workspace: Workspace }> => {
  const workspace = opened(ws.root);
  const index = await searchIndex(workspace);
  const expected = {
    code: codeFingerprint(),
    root: canonicalRoot(ws.root),
    digest: searchDigest(index.store, index.metamodel),
  };
  return { index, expected, workspace };
};

const parse = (text: string, expected: ExpectedHeader, index: SearchIndex, store = index.store) =>
  parseSearchIndex(text, expected, store, index.layout, index.metamodel);

const hitIds = (index: SearchIndex | undefined, query: string): string[] =>
  index === undefined ? [] : searchElements(index, query).hits.map((h) => h.element.id);

describe("search.json (ADR-0008)", () => {
  it("serialises the index with its header and loads it again for the same store", async () => {
    const { index, expected } = await built(await fixture());
    const text = serializeSearchIndex(index, expected);
    expect(JSON.parse(text.slice(0, text.indexOf("\n")))).toEqual({
      format: SEARCH_CACHE_FORMAT,
      ...expected,
    });
    const loaded = parse(text, expected, index);
    expect(loaded?.store).toBe(index.store);
    expect(loaded?.engine.generation).toBe(0);
    expect(hitIds(loaded, "squals")).toEqual([N1]);
    expect(hitIds(loaded, "SR-3f4a5b")).toEqual([S1]);
    if (loaded === undefined) {
      throw new Error("The cache was not loaded.");
    }
    expect(searchElements(loaded, "gusts")).toEqual(searchElements(index, "gusts"));
  });

  it("is refused for another format, code, root or digest, or when it is no index of every record", async () => {
    const { index, expected } = await built(await fixture());
    const text = serializeSearchIndex(index, expected);
    const header = (change: Record<string, unknown>): string =>
      `${JSON.stringify({ format: SEARCH_CACHE_FORMAT, ...expected, ...change })}${text.slice(text.indexOf("\n"))}`;
    expect(parse(header({ format: 0 }), expected, index)).toBeUndefined();
    expect(parse(header({ code: "other" }), expected, index)).toBeUndefined();
    expect(parse(header({ root: "/elsewhere" }), expected, index)).toBeUndefined();
    expect(parse(header({ digest: "0".repeat(64) }), expected, index)).toBeUndefined();
    expect(parse(`[]${text.slice(text.indexOf("\n"))}`, expected, index)).toBeUndefined();
    expect(parse("not json", expected, index)).toBeUndefined();
    expect(parse(`${text.slice(0, text.indexOf("\n"))}\n{"index": 5}`, expected, index)).toBeUndefined();
    // A store with a record the index has no document of, or one record fewer.
    const [first, second] = index.store.elements;
    if (first === undefined || second === undefined) {
      throw new Error("no elements");
    }
    const other = (elements: ElementStore["elements"]): ElementStore => ({ ...index.store, elements });
    expect(parse(text, expected, index, other([first, { ...second, file: "elsewhere.md" }]))).toBeUndefined();
    expect(parse(text, expected, index, other([first]))).toBeUndefined();
  });

  it("has a digest of the file entries and of the part of the metamodel that decides the documents", async () => {
    const { index } = await built(await fixture());
    const { store, metamodel } = index;
    const digest = searchDigest(store, metamodel);
    expect(searchDigest({ ...store }, metamodel)).toBe(digest);
    const [first, ...rest] = store.elements;
    if (first === undefined) {
      throw new Error("no elements");
    }
    const changed = (record: typeof first): string =>
      searchDigest({ ...store, elements: [record, ...rest] }, metamodel);
    expect(changed({ ...first, snapshot: { ...first.snapshot, sha256: "0".repeat(64) } })).not.toBe(digest);
    expect(changed({ ...first, file: "moved.md" })).not.toBe(digest);
    expect(changed({ ...first, repository: "other" })).not.toBe(digest);
    expect(searchDigest({ ...store, elements: rest }, metamodel)).not.toBe(digest);
    // The title key, the relation keys and the names of the choices, types and statuses (#80); not
    // the rest of the metamodel.
    const renamed = metamodel.properties.map((p) =>
      p.choices === undefined ? p : { ...p, choices: p.choices.map((c) => ({ ...c, name: `${c.name}!` })) },
    );
    expect(searchDigest(store, { ...metamodel, properties: renamed })).not.toBe(digest);
    const status = metamodel.statuses.map((s) => (s.key === "draft" ? { ...s, name: "Entwurfzustand" } : s));
    expect(searchDigest(store, { ...metamodel, statuses: status })).not.toBe(digest);
    const type = metamodel.effectiveTypes.map((t, i) => (i === 0 ? { ...t, name: `${t.name}!` } : t));
    expect(searchDigest(store, { ...metamodel, effectiveTypes: type })).not.toBe(digest);
    expect(searchDigest(store, { ...metamodel, relations: [...metamodel.relations] })).toBe(digest);
    const untitled = metamodel.properties.map((p) =>
      p.meaning === "title" ? { key: p.key, name: p.name, kind: p.kind } : p,
    );
    expect(searchDigest(store, { ...metamodel, properties: untitled })).not.toBe(digest);
  });

  it("is read from the cache folder, and nothing is used when there is none or it cannot be read", async () => {
    const { index, expected } = await built(await fixture());
    const folder = await tempFolder();
    const read = () => readSearchCache(folder, expected, index.store, index.layout, index.metamodel);
    expect(await read()).toBeUndefined();
    await saveSearchCache(folder, expected, index);
    expect(hitIds(await read(), "barometer")).toEqual([S1]);
    // A folder in its place cannot be read as a file.
    await fs.rm(path.join(folder, SEARCH_CACHE_FILE));
    await fs.mkdir(path.join(folder, SEARCH_CACHE_FILE));
    expect(await read()).toBeUndefined();
  });

  it("is not written for an index that changed since its build, and a failed write is ignored", async () => {
    const ws = await fixture();
    const { index, expected, workspace } = await built(ws);
    const folder = await tempFolder();
    // A carry changes the MiniSearch object, which the index of the old store shares.
    await updateElement(workspace, { ref: N1, title: "Rain" });
    expect((await searchIndex(workspace)).engine).toBe(index.engine);
    await saveSearchCache(folder, expected, index);
    await expect(fs.readdir(folder)).resolves.toEqual([]);
    // A cache folder that is a file: nothing is written, nothing fails.
    const file = path.join(folder, "file");
    await fs.writeFile(file, "");
    const fresh = await built(ws);
    await expect(saveSearchCache(file, fresh.expected, fresh.index)).resolves.toBeUndefined();
  });
});

describe("search index state with a cache folder (ADR-0008)", () => {
  /** An index of the store of `index` whose documents all hold the word `marker`: tells a loaded cache from a build. */
  const marked = (index: SearchIndex): SearchIndex => {
    const mini = new MiniSearch<SearchDocument>(ENGINE_OPTIONS);
    mini.addAll(index.store.elements.map((r) => ({ ...documentOf(r, "", index.metamodel), text: "marker" })));
    return searchIndexOf(index.store, index.layout, index.metamodel, mini);
  };

  it("writes the index it built and takes it from the cache in the next process", async () => {
    const ws = await fixture();
    const cache = await tempFolder();
    const first = opened(ws.root, cache);
    const index = await searchIndex(first);
    await first.close();
    const written = await fs.readFile(path.join(cache, SEARCH_CACHE_FILE), "utf8");
    const expected = {
      code: codeFingerprint(),
      root: canonicalRoot(ws.root),
      digest: searchDigest(index.store, index.metamodel),
    };
    expect(written).toBe(serializeSearchIndex(index, expected));
    // The next process loads the file: an index made to hold the word `marker` proves it.
    await fs.writeFile(path.join(cache, SEARCH_CACHE_FILE), serializeSearchIndex(marked(index), expected));
    const second = opened(ws.root, cache);
    expect(hitIds(await searchIndex(second), "marker")).toHaveLength(2);
    // A changed file gives another digest: the index is built again, and written again.
    await second.close();
    await ws.write("needs/N-545b7b379da2.md", element(N1, "need", "Wind speed", "Drizzle."));
    const third = opened(ws.root, cache);
    const rebuilt = await searchIndex(third);
    expect(hitIds(rebuilt, "marker")).toEqual([]);
    expect(hitIds(rebuilt, "drizzle")).toEqual([N1]);
    await third.close();
    expect(await fs.readFile(path.join(cache, SEARCH_CACHE_FILE), "utf8")).toContain("drizzle");
  });

  it("carries an index loaded from the cache by discarding the documents it replaces", async () => {
    const ws = await fixture();
    const cache = await tempFolder();
    const first = opened(ws.root, cache);
    await searchIndex(first);
    await first.close();
    const second = opened(ws.root, cache);
    const loaded = await searchIndex(second);
    // The cache holds the index, not the documents a carry would remove exactly.
    expect(loaded.engine.documents).toBeUndefined();
    await updateElement(second, { ref: N1, title: "Rain", text: "Drizzle.\n" });
    const carried = await searchIndex(second);
    expect(carried.engine).toBe(loaded.engine);
    expect(hitIds(carried, "drizzle")).toEqual([N1]);
    expect(hitIds(carried, "gusts")).toEqual([]);
    expect(carried.engine.mini.dirtCount).toBe(1);
  });

  it("writes no index whose texts are not those of the store's snapshots", async () => {
    const ws = await fixture();
    const cache = await tempFolder();
    const workspace = opened(ws.root, cache);
    await workspace.get(elementStoreState);
    await ws.write("needs/N-545b7b379da2.md", element(N1, "need", "Wind speed", "Drizzle."));
    expect(hitIds(await searchIndex(workspace), "drizzle")).toEqual([N1]);
    await workspace.close();
    await expect(fs.readdir(cache)).resolves.not.toContain(SEARCH_CACHE_FILE);
  });

  it("uses no cache folder inside a repository, and a server neither reads nor writes one", async () => {
    const ws = await fixture();
    const inside = ws.path(".cache");
    const workspace = opened(ws.root, inside);
    expect(hitIds(await searchIndex(workspace), "gusts")).toEqual([N1]);
    await workspace.close();
    await expect(fs.access(path.join(inside, SEARCH_CACHE_FILE))).rejects.toThrow();
    const cache = await tempFolder();
    const reader = opened(ws.root, cache);
    const index = await searchIndex(reader);
    await reader.close();
    const expected = {
      code: codeFingerprint(),
      root: canonicalRoot(ws.root),
      digest: searchDigest(index.store, index.metamodel),
    };
    await fs.writeFile(path.join(cache, SEARCH_CACHE_FILE), serializeSearchIndex(marked(index), expected));
    // A server builds it in the background: the marked file is not read, and not replaced.
    const server = opened(ws.root, cache);
    warmSearchIndex(server, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.peek(searchIndexState)).toBeDefined();
    const served = await searchIndex(server);
    expect(hitIds(served, "marker")).toEqual([]);
    expect(hitIds(served, "gusts")).toEqual([N1]);
    await server.close();
    expect(await fs.readFile(path.join(cache, SEARCH_CACHE_FILE), "utf8")).toContain("marker");
  });

  it("is not started for a closed workspace, and a build stops when its workspace closes", async () => {
    const ws = await fixture();
    const closed = new Workspace(ws.root);
    await closed.close();
    expect(() => {
      warmSearchIndex(closed, 0);
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed.peek(searchIndexState)).toBeUndefined();
    const files: Record<string, string> = {};
    for (let n = 0; n < 501; n += 1) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      files[`bulk/N-${id.slice(-12)}.md`] = element(id, "need", `Bulk ${String(n)}`, "");
    }
    for (const [file, text] of Object.entries(files)) {
      await ws.write(file, text);
    }
    const workspace = new Workspace(ws.root);
    await workspace.get(elementStoreState);
    await workspace.get(metamodelState);
    await workspace.get(workspaceLayoutState);
    const building = searchIndex(workspace);
    const closing = workspace.close();
    await expect(building).rejects.toThrow("no longer needed");
    await closing;
    const { store, layout, metamodel } = { ...(await built(ws)).index };
    await expect(buildSearchIndex(store, layout, metamodel)).resolves.toMatchObject({ exact: true });
  });
});
