// The full-text search index (ADR-0008 "Search", #323) in the performance suite (ADR-0011) on the
// generated workspace of N-036 with 50,000 elements and 200,000 relations: building it, its heap,
// serialising it into the cache folder and loading it again (a start with the cache), searches
// (compare SR-098: the first hits within 300 ms), opening an element while a server builds the index
// in the background (compare SR-082 AK3: 200 ms), and carrying it over a save and over a pull of
// 1,000 files (SR-007 AK2: search current within 10 s). The generated texts are short and use a
// small vocabulary, so an in-memory index of 50,000 longer texts from a large vocabulary is measured
// as well. Recorded only: the tagged SR-098 test is search-speed.test.ts (#110).
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import { generateLargeWorkspace, measure, writeLargeWorkspace } from "@reqseq/testkit";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import MiniSearch from "minisearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Metamodel } from "../../src/metamodel/index.js";
import { findType, metamodelState } from "../../src/metamodel/index.js";
import type { ElementRecord, ElementStore } from "../../src/model/index.js";
import { applyStoreChange, elementStoreState, updateElements, warmModel } from "../../src/model/index.js";
import type { SearchDocument, SearchElementsOptions } from "../../src/query/search-index.js";
import {
  ENGINE_OPTIONS,
  buildSearchIndex,
  documentOf,
  searchElements,
  searchIndexOf,
} from "../../src/query/search-index.js";
import { parseSearchIndex, searchDigest, serializeSearchIndex } from "../../src/query/search-cache.js";
import { searchIndex, warmSearchIndex } from "../../src/query/search-state.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import type { WorkspaceLayout } from "../../src/workspace/index.js";
import { canonicalRoot, workspaceLayoutState, writeCacheFile } from "../../src/workspace/index.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** A pull (SR-007 AK2). */
const PULLED = 1000;
const basis = "SR-068, SR-098, N-036 (recorded; #80 and #110 assert SR-098)";

/** Heap in use after a full collection (the suite runs with `--expose-gc`), in MB. */
const heapMb = (): number => {
  (globalThis as { gc?: () => void }).gc?.();
  return process.memoryUsage().heapUsed / 1e6;
};

/** Runs `run` and gives its result with the longest time the event loop was blocked meanwhile, in ms. */
const blocking = async <T>(run: () => Promise<T>): Promise<{ readonly result: T; readonly ms: number }> => {
  const delay = monitorEventLoopDelay({ resolution: 5 });
  delay.enable();
  try {
    const result = await run();
    return { result, ms: Math.round(delay.max / 1e6) };
  } finally {
    delay.disable();
  }
};

describe("search index with 50,000 elements and 200,000 relations (ADR-0008, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let store: ElementStore;
  let layout: WorkspaceLayout;
  let metamodel: Metamodel;

  beforeAll(async () => {
    tree = generateLargeWorkspace({
      version: versionOf(await standardModel()),
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    getCommandRuntime();
    store = await workspace.get(elementStoreState);
    layout = await workspace.get(workspaceLayoutState);
    metamodel = await workspace.get(metamodelState);
    expect(store.elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  const opened = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };

  it("records building the index, its heap, and searches", async () => {
    const before = heapMb();
    const { result: built } = await measure(
      "search index: build (read 50,000 texts, index title, text, properties)",
      () => blocking(() => searchIndex(opened())),
      { basis: "ADR-0008 (built once per store, in slices)" },
    );
    const index = built.result;
    await measure(
      `search index: build, longest block of the event loop ${String(built.ms)} ms`,
      () => built.ms,
      {
        basis: "ADR-0008 (slices of 5 ms)",
      },
    );
    const heap = Math.round(heapMb() - before);
    await measure(`search index heap: about ${String(heap)} MB`, () => heap, { basis: "ADR-0008 (memory)" });
    const record = store.elements[Math.floor(ELEMENTS / 2)];
    if (record === undefined) {
      throw new Error("no element");
    }
    const title = String(record.data["title"]);
    const shortId = `${String(findType(metamodel, record.type)?.prefix)}-${record.id.slice(-6)}`;
    const queries: readonly (readonly [string, string, SearchElementsOptions?])[] = [
      ["one word in a fifth of the titles", "wind"],
      ["two words", "battery level"],
      ["a typo", "temperatur"],
      ["a typo in another case", "HUMIDTY"],
      ["one letter (as-you-type)", "s"],
      ["two letters (as-you-type)", "st"],
      ["three letters (as-you-type)", "sen"],
      ["a word of every text", "the"],
      ["a whole title", title],
      ["a short ID", shortId],
      ["a tail of a UUID", record.id.slice(-8)],
      ["a word in every acceptance criterion", "runs"],
      ["one word within a selection of 10,000", "wind", { within: store.elements.slice(0, 10_000) }],
      ["one word, the first 50 hits", "wind", { limit: 50 }],
      ["one word, every hit described", "wind", { limit: ELEMENTS }],
    ];
    for (const [name, query, options] of queries) {
      const { result } = await measure(
        `search: ${name} (${JSON.stringify(query)})`,
        () => searchElements(index, query, options),
        { basis },
      );
      expect(result.total, name).toBeGreaterThan(0);
    }
    expect(searchElements(index, title).hits[0]?.element).toBe(record);
    expect(searchElements(index, shortId).hits[0]?.element).toBe(record);
    // The command (#80): selection, index, search and the output of the first page, through invoke.
    const variant = store.elements.find((r) => r.type === "variant");
    const commands: readonly (readonly [string, Record<string, unknown>])[] = [
      ["one word", { query: "wind" }],
      ["a typo", { query: "temperatur" }],
      ["two letters (as-you-type)", { query: "st" }],
      ["a word of every text", { query: "the" }],
      ["a short ID, title and IDs only (SR-066)", { query: shortId, fields: ["title", "id"] }],
      ["one word within a filter", { query: "wind", selection: { where: { type: ["system-requirement"] } } }],
      ["one word within a variant view", { query: "wind", selection: { view: String(variant?.id) } }],
    ];
    for (const [name, input] of commands) {
      const { result } = await measure(
        `element.search: ${name} (${JSON.stringify(input["query"])}), the first 50 hits`,
        () => invoke("element.search", input, { workspace: opened() }),
        { basis },
      );
      expect((result as { total: number }).total, name).toBeGreaterThan(0);
    }
    await measure(
      'element.list with the condition text "wind" (SR-068, SR-082 AK4: 500 ms)',
      () => invoke("element.list", { selection: { where: { text: "wind" } } }, { workspace: opened() }),
      { basis: "SR-082 AK4 (recorded)" },
    );
  });

  it("records serialising the index into the cache folder and loading it again", async () => {
    const index = await searchIndex(opened());
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-search-cache-"));
    try {
      const root = canonicalRoot(opened().root);
      const { result: digest } = await measure(
        "search cache: digest of 50,000 file entries",
        () => searchDigest(store, metamodel),
        { basis: "ADR-0008 (start with the cache)" },
      );
      const expected = { code: "code", root, digest };
      const { result: file } = await measure(
        "search cache: serialise and write search.json",
        () => writeCacheFile(folder, "search.json", serializeSearchIndex(index, expected)),
        { basis: "ADR-0008 (a one-shot process after a build)" },
      );
      const { size } = await fs.stat(file);
      await measure(`search cache size: ${String(Math.round(size / 1e6))} MB`, () => size, {
        basis: "ADR-0008 (disk use per copy)",
      });
      const text = await fs.readFile(file, "utf8");
      const { result: loaded } = await measure(
        "search cache: parse and load search.json (a one-shot process with the cache)",
        () => parseSearchIndex(text, expected, store, layout, metamodel),
        { basis: "ADR-0008 (one blocking call)" },
      );
      if (loaded === undefined) {
        throw new Error("the cache did not load");
      }
      expect(loaded.engine.mini.documentCount).toBe(ELEMENTS);
      expect(searchElements(loaded, "wind").total).toBe(searchElements(index, "wind").total);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("records opening an element while a server builds the index in the background", async () => {
    const fresh = new Workspace(opened().root);
    try {
      const open = async (label: string, ids: readonly string[]): Promise<void> => {
        for (const [n, id] of ids.entries()) {
          await measure(
            `element.get ${String(n + 1)} ${label} (compare SR-082 AK3, 200 ms)`,
            () => invoke("element.get", { ref: id }, { workspace: fresh }),
            { basis: "SR-082 AK3 (recorded: the search index in the background, #323)" },
          );
        }
      };
      // As `reqseq serve api` does it (`warmWorkspace`): the model loaded, then the index in the
      // background, here without the delay, so that the opens below run while it builds.
      await warmModel(fresh);
      await open(
        "after the start, without a search index",
        store.elements.slice(20_000, 20_005).map((r) => r.id),
      );
      warmSearchIndex(fresh, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await open(
        "while the search index builds",
        store.elements.slice(30_000, 30_005).map((r) => r.id),
      );
      await measure("search index: ready after the start (background build)", () => searchIndex(fresh), {
        basis: "ADR-0008 (background build after the warm-up)",
      });
    } finally {
      await fresh.close();
    }
  });

  it("records carrying the index over a save and over a pull of 1,000 files", async () => {
    const ws = opened();
    await searchIndex(ws);
    const [saved] = store.elements;
    if (saved === undefined) {
      throw new Error("no element");
    }
    const folderOf = (record: ElementRecord): string =>
      String(layout.repositories.find((r) => r.name === record.repository)?.folder);
    const rewrite = async (record: ElementRecord, word: string): Promise<void> => {
      const file = path.join(folderOf(record), record.file);
      await fs.writeFile(file, `${await fs.readFile(file, "utf8")}\n${word}\n`);
    };
    const apply = async (records: readonly ElementRecord[]): Promise<void> => {
      const changes = new Map<string, { paths: string[] }>();
      for (const record of records) {
        const entry = changes.get(record.repository) ?? { paths: [] };
        entry.paths.push(record.file);
        changes.set(record.repository, entry);
      }
      await applyStoreChange(ws, (now) => updateElements(now, layout, changes));
    };
    await rewrite(saved, "zanzibar");
    const { result: afterSave } = await measure(
      "search index: carried over a save of one file (store update and carry)",
      async () => {
        await apply([saved]);
        return searchIndex(ws);
      },
      { basis: "ADR-0008 (a save in a server)" },
    );
    expect(searchElements(afterSave, "zanzibar").hits.map((h) => h.element.file)).toEqual([saved.file]);
    const pulled = store.elements.slice(1000, 1000 + PULLED);
    for (const record of pulled) {
      await rewrite(record, "quokka");
    }
    const { result: afterPull } = await measure(
      "search index: carried over a pull of 1,000 files (store update and carry)",
      async () => {
        await apply(pulled);
        return searchIndex(ws);
      },
      { basis: "SR-007 AK2 (search current within 10 s)" },
    );
    expect(searchElements(afterPull, "quokka").total).toBe(PULLED);
    const { result: fresh } = await measure(
      "search index: fresh build of the store after the pull",
      async () => (await buildSearchIndex(afterPull.store, layout, metamodel)).index,
      { basis: "ADR-0008 (compare the carry)" },
    );
    // The old documents were removed exactly: nothing to vacuum, scores equal a fresh build's.
    expect(afterPull.engine.mini.dirtCount).toBe(0);
    for (const query of ["quokka", "wind", "zanzibar", "temperatur"]) {
      const carried = searchElements(afterPull, query).hits;
      const built = searchElements(fresh, query).hits;
      expect(carried.map((h) => [h.element.file, h.fields, h.terms])).toEqual(
        built.map((h) => [h.element.file, h.fields, h.terms]),
      );
      carried.forEach((hit, i) => {
        expect(hit.score).toBeCloseTo(built[i]?.score ?? 0, 9);
      });
    }
  });

  it("records an in-memory index of 50,000 texts of 150 words from a vocabulary of 30,000 words", async () => {
    let seed = 7;
    const random = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const letters = "abcdefghijklmnopqrstuvwxyzäöü";
    const vocabulary = Array.from({ length: 30_000 }, () =>
      Array.from({ length: 4 + random(8) }, () => letters.charAt(random(letters.length))).join(""),
    );
    const sentence = (count: number): string =>
      Array.from({ length: count }, () => vocabulary[random(vocabulary.length)]).join(" ");
    const records: ElementRecord[] = Array.from({ length: ELEMENTS }, (_, i) => ({
      id: randomUUID(),
      type: "system-requirement",
      repository: "system",
      file: `sr/${String(i)}.md`,
      data: { title: sentence(6), rationale: sentence(12) },
      eol: "\n",
      closingEol: "\n",
      bom: false,
      snapshot: { path: `sr/${String(i)}.md`, size: 0, mtimeMs: 0, sha256: "" },
    }));
    const synthetic: ElementStore = {
      elements: records,
      byId: new Map(records.map((r) => [r.id, [r]])),
      nonElements: [],
      problems: [],
    };
    const before = heapMb();
    const { result: index } = await measure(
      "search index (synthetic, 150 words per text, 30,000 words): build in memory",
      () => {
        // As a build does it: the documents kept for carries (`SearchEngine.documents`).
        const mini = new MiniSearch<SearchDocument>(ENGINE_OPTIONS);
        const documents = new Map<string, SearchDocument>();
        for (const record of records) {
          const document = documentOf(record, sentence(150), metamodel);
          mini.add(document);
          documents.set(document.key, document);
        }
        return searchIndexOf(synthetic, layout, metamodel, mini, documents);
      },
      { basis: "ADR-0008 (texts longer than the generated ones)" },
    );
    const heap = Math.round(heapMb() - before);
    await measure(`search index heap (synthetic): about ${String(heap)} MB`, () => heap, {
      basis: "ADR-0008 (memory)",
    });
    const word = String(vocabulary[123]);
    for (const [name, query] of [
      ["one word", word],
      ["a typo", `${word.slice(0, -1)}x`],
      ["one letter", "k"],
      ["two letters", word.slice(0, 2)],
      ["three letters", word.slice(0, 3)],
      ["two words", `${word} ${String(vocabulary[456])}`],
    ] as const) {
      const { result } = await measure(
        `search (synthetic): ${name} (${JSON.stringify(query)})`,
        () => searchElements(index, query),
        { basis },
      );
      expect(result.total).toBeGreaterThanOrEqual(0);
    }
  });
});
