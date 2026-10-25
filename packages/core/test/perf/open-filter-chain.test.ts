// SR-082 AK3 and AK4 in the performance suite (ADR-0011): opening an element, applying a filter and
// computing a chain in the generated workspace of N-036 with 50,000 elements and 200,000 relations.
// Stage 1 has no `element.get`, no filter language (SR-070, stage 3) and no chain (SR-022, stage 2),
// so each criterion is measured at the lowest level core has (#127, option 1): opening is the lookup
// of the UUID in the store, the read of its file and the element view that `element.create` and
// `element.update` return; the filter and the chain run on the in-memory store and an index of
// incoming relations, which ADR-0008 says they will run on. Later stages add tests of their commands
// with the same tags. The tests are tagged, so they assert their thresholds (ADR-0011, #215) after
// `measure` recorded the times.
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, measure, thresholdMessage, writeLargeWorkspace } from "@logreq/testkit";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RACY_MS, serializeModelCache } from "../../src/model/model-cache.js";
import type { LoadedStore } from "../../src/model/store.js";
import { canonicalRoot, writeCacheFile } from "../../src/workspace/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readElementFile } from "../../src/files/index.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import {
  elementStoreState,
  elementView,
  embeddedImages,
  hasId,
  ignoredBy,
  resolveTarget,
  shortIdState,
  successionsFor,
  titleKeyOf,
  warmWorkspace,
} from "../../src/model/index.js";
import { Workspace } from "../../src/runtime/workspace.js";
import type { WorkspaceLayout } from "../../src/workspace/index.js";
import { availableRepositories, workspaceLayoutState } from "../../src/workspace/index.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK3. */
const OPEN_MS = 200;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** The versions stored in relations do not matter here: nothing compares them. */
const VERSION: VersionFunction = () => "n1:0000000000000000";

/** The keys of the relation kinds with the meaning `derivation` (SR-013): the links of a chain. */
const derivationKeys = (metamodel: Metamodel): string[] =>
  metamodel.relations.filter((r) => r.meaning === "derivation").map((r) => r.key);

/**
 * The index of incoming derivation relations (ADR-0008 plans one in the model, built with the store):
 * for each element, the elements whose relations under `keys` point at it.
 */
const incomingIndex = (store: ElementStore, keys: readonly string[]): Map<ElementRecord, ElementRecord[]> => {
  const incoming = new Map<ElementRecord, ElementRecord[]>();
  for (const source of store.elements) {
    for (const key of keys) {
      const value = source.data[key];
      for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
        const match = hasId(item) ? resolveTarget(store, source.repository, item) : undefined;
        if (match?.kind === "found") {
          const list = incoming.get(match.element) ?? [];
          list.push(source);
          incoming.set(match.element, list);
        }
      }
    }
  }
  return incoming;
};

/** The chain below `top` (SR-022 down the derivation): every element that derives from it, directly or not. */
const chainBelow = (
  incoming: ReadonlyMap<ElementRecord, readonly ElementRecord[]>,
  top: ElementRecord,
): Set<ElementRecord> => {
  const seen = new Set<ElementRecord>();
  const queue = [top];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const child of incoming.get(next) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return seen;
};

describe("open, filter and chain with 50,000 elements and 200,000 relations (SR-082, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let store: ElementStore;
  let metamodel: Metamodel;
  let layout: WorkspaceLayout;
  let shortIds: ShortIds;

  beforeAll(async () => {
    tree = generateLargeWorkspace({ version: VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server or the app does it at start (SR-082 AK1, AK2).
    await warmWorkspace(workspace);
    store = await workspace.get(elementStoreState);
    metamodel = await workspace.get(metamodelState);
    layout = await workspace.get(workspaceLayoutState);
    shortIds = await workspace.get(shortIdState);
    expect(store.elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it("records the time and size of writing the model cache (ADR-0008, no threshold)", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-082-cache-"));
    try {
      const root = canonicalRoot(fixture?.workspaceRoot ?? "");
      // A load that started once the generated files settled: every file gets its entry.
      const settledStart = Date.now() + 2 * RACY_MS;
      const { result: file } = await measure(
        "model cache: serialise and write model.json (50,000 files)",
        async () =>
          writeCacheFile(folder, "model.json", serializeModelCache(root, store as LoadedStore, settledStart)),
        { basis: "SR-082 (background write after a start that changed the cache)" },
      );
      const { size } = await fs.stat(file);
      await measure(`model cache size: ${String(Math.round(size / 1e6))} MB`, () => size, {
        basis: "SR-082 (disk use per copy, ADR-0008)",
      });
      expect(size).toBeGreaterThan(0);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  /**
   * Opening an element as `element.get` will: look it up, read its file, build its view, with its
   * successors (`successionsFor`, SR-072 AK3). With `superseded`, the element is shown as if its
   * status were `obsolete` (marked invalid; no generated element has one), so the view builds the
   * succession index of a store that has none yet.
   */
  const openElement = async (
    id: string,
    current: { readonly store: ElementStore; readonly shortIds: ShortIds },
    superseded = false,
  ): Promise<ReturnType<typeof elementView>> => {
    const titleKey = titleKeyOf(metamodel) ?? "title";
    const [stored] = current.store.byId.get(id) ?? [];
    const record =
      stored === undefined || !superseded
        ? stored
        : { ...stored, data: { ...stored.data, status: "obsolete" } };
    const repository = availableRepositories(layout).find((r) => r.name === record?.repository);
    if (record === undefined || repository === undefined) {
      throw new Error(`element ${id} is not in the store`);
    }
    const read = await readElementFile(repository.folder, record.file);
    if (read.kind !== "parsed") {
      throw new Error(`cannot read ${record.file}`);
    }
    const images = await embeddedImages(
      { repository, ignored: ignoredBy(layout) },
      record.file,
      read.file.body,
    );
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return elementView({
      successions: successionsFor(workspace, current.store, metamodel, record),
      record,
      file: read.file,
      metamodel,
      store: current.store,
      shortIds: current.shortIds,
      titleKey,
      layout,
      images,
    });
  };

  it("[SR-082/AK3] shows an element within 200 ms of opening it", async () => {
    const id = tree.elements[Math.floor(ELEMENTS / 2)]?.id ?? "";
    const { result: view, measurement } = await measure(
      "open one element (look up, read its file, element view)",
      () => openElement(id, { store, shortIds }),
      { basis: "SR-082 AK3 (core: store lookup, file read, element view; #127)", thresholdMs: OPEN_MS },
    );
    expect(view.id).toBe(id);
    expect(view.problems).toEqual([]);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });

  it("[SR-082/AK4] applies a filter within 500 ms", async () => {
    const titleKey = titleKeyOf(metamodel) ?? "title";
    const title = (record: ElementRecord): string => {
      const value = record.data[titleKey];
      return typeof value === "string" ? value : "";
    };
    const { result: found, measurement } = await measure(
      "filter: system requirements with status draft, sorted by title",
      () =>
        store.elements
          .filter((e) => e.type === "system-requirement" && e.data["status"] === "draft")
          .sort((a, b) => title(a).localeCompare(title(b))),
      { basis: "SR-082 AK4 (core: filter over the in-memory store; #127)", thresholdMs: RESULT_MS },
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((e) => e.type === "system-requirement")).toBe(true);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] computes a chain within 500 ms", async () => {
    const keys = derivationKeys(metamodel);
    const need = tree.elements.find((e) => e.type === "need");
    const [top] = store.byId.get(need?.id ?? "") ?? [];
    if (top === undefined) {
      throw new Error("the generated workspace has no need");
    }
    // Built once with the store in the model (ADR-0008); recorded, no threshold of its own.
    const { result: incoming } = await measure(
      "index of incoming derivation relations (200,000 relations)",
      () => incomingIndex(store, keys),
      { basis: "SR-082 AK4 (part of loading the model, not of computing a chain)" },
    );
    const { result: chain, measurement } = await measure(
      "chain: every element derived from the first need",
      () => chainBelow(incoming, top),
      { basis: "SR-082 AK4 (core: graph walk over the in-memory index; #127)", thresholdMs: RESULT_MS },
    );
    expect(keys).toEqual(expect.arrayContaining(["refines", "derives-from"]));
    expect(chain.size).toBeGreaterThan(0);
    expect(chain.has(top)).toBe(false);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  // Last: it changes a file of the workspace.
  it("[SR-082/AK3] shows an element within 200 ms of opening it right after a save", async () => {
    const opened = workspace;
    if (opened === undefined) {
      throw new Error("no workspace");
    }
    const saved = tree.elements[Math.floor(ELEMENTS / 3)]?.id ?? "";
    const id = tree.elements[Math.floor(ELEMENTS / 2) + 1]?.id ?? "";
    // As an API server after a `workspace.check`: every finding state is built (no findings in the
    // generated workspace, so the carry walks every element without locating anything).
    const { result: checked } = await measure(
      "workspace.check in the loaded workspace (builds every finding state)",
      () => invoke("workspace.check", {}, { workspace: opened }),
      { basis: "SR-082 AK3 (the states the save carries over; no threshold of its own)" },
    );
    expect(checked).toEqual({ ok: true, problems: [], checkedElements: ELEMENTS });
    // The save puts the written file into the store and carries the short IDs and findings over (#184).
    await measure(
      "save one element (element.update of its title)",
      () =>
        invoke(
          "element.update",
          { ref: saved, title: "Saved in the performance suite" },
          { workspace: opened },
        ),
      { basis: "SR-082 AK3 (the save before the open; no threshold of its own)" },
    );
    const { result: view, measurement } = await measure(
      "open one element right after a save (store and short IDs as the save left them, file read, element view)",
      async () =>
        openElement(
          id,
          { store: await opened.get(elementStoreState), shortIds: await opened.get(shortIdState) },
          // Superseded: the first such view after the save builds the succession index (SR-072 AK3).
          true,
        ),
      { basis: "SR-082 AK3 (core: open after a save, #184; #127)", thresholdMs: OPEN_MS },
    );
    expect(view.id).toBe(id);
    expect((await opened.get(elementStoreState)).byId.get(saved)?.[0]?.data["title"]).toBe(
      "Saved in the performance suite",
    );
    // The carried finding states equal a fresh check: none, as before the save.
    const { result: rechecked } = await measure(
      "workspace.check right after a save (finding states carried over, #184)",
      () => invoke("workspace.check", {}, { workspace: opened }),
      { basis: "SR-020 (a check after a save; no threshold of its own)" },
    );
    expect(rechecked).toEqual({ ok: true, problems: [], checkedElements: ELEMENTS });
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });
});
