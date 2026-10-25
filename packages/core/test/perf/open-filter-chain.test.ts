// SR-082 AK3 and AK4 in the performance suite (ADR-0011): opening an element, applying a filter and
// computing a chain in the generated workspace of N-036 with 50,000 elements and 200,000 relations.
// Opening is `element.get` (look up, read the file, element view with its hints and successors).
// Stage 1 has no filter language (SR-070, stage 3) and no chain (SR-022, stage 2), so these are
// measured at the lowest level core has (#127, option 1): they run on the in-memory store and an
// index of incoming relations, which ADR-0008 says they will run on. Later stages add tests of their commands
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
import type { CommandOutput } from "../../src/catalog.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import type { ElementRecord, ElementStore } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import { elementStoreState, hasId, resolveTarget, titleKeyOf, warmWorkspace } from "../../src/model/index.js";
import { Workspace } from "../../src/runtime/workspace.js";

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

  beforeAll(async () => {
    tree = generateLargeWorkspace({ version: VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server or the app does it at start (SR-082 AK1, AK2).
    await warmWorkspace(workspace);
    store = await workspace.get(elementStoreState);
    metamodel = await workspace.get(metamodelState);
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

  /** Opening an element: `element.get`, as every access calls it (SR-080). */
  const openElement = async (
    opened: Workspace,
    id: string,
  ): Promise<CommandOutput<"element.get">["element"]> =>
    ((await invoke("element.get", { ref: id }, { workspace: opened })) as CommandOutput<"element.get">)
      .element;

  /** A system requirement and the target of its first derives-from relation, both in the store. */
  const relationToTarget = (): { readonly source: ElementRecord; readonly target: ElementRecord } => {
    for (const source of store.elements.slice(Math.floor(ELEMENTS / 4))) {
      const [first] = Array.isArray(source.data["derives-from"])
        ? (source.data["derives-from"] as unknown[])
        : [];
      const match = hasId(first) ? resolveTarget(store, source.repository, first) : undefined;
      if (match?.kind === "found") {
        return { source, target: match.element };
      }
    }
    throw new Error("the generated workspace has no derives-from relation");
  };

  const opened = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };

  it("[SR-082/AK3] shows an element within 200 ms of opening it", async () => {
    const id = tree.elements[Math.floor(ELEMENTS / 2)]?.id ?? "";
    const { result: view, measurement } = await measure(
      "open one element (look up, read its file, element view)",
      () => openElement(opened(), id),
      { basis: "SR-082 AK3 (element.get: store lookup, file read, element view)", thresholdMs: OPEN_MS },
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
    const current = opened();
    const saved = tree.elements[Math.floor(ELEMENTS / 3)]?.id ?? "";
    const id = tree.elements[Math.floor(ELEMENTS / 2) + 1]?.id ?? "";
    // As an API server after a `workspace.check`: every finding state is built (no findings in the
    // generated workspace, so the carry walks every element without locating anything).
    const { result: checked } = await measure(
      "workspace.check in the loaded workspace (builds every finding state)",
      () => invoke("workspace.check", {}, { workspace: current }),
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
          { workspace: current },
        ),
      { basis: "SR-082 AK3 (the save before the open; no threshold of its own)" },
    );
    const { result: view, measurement } = await measure(
      "open one element right after a save (element.get on the store and short IDs as the save left them)",
      () => openElement(current, id),
      { basis: "SR-082 AK3 (element.get after a save, #184)", thresholdMs: OPEN_MS },
    );
    expect(view.id).toBe(id);
    expect((await current.get(elementStoreState)).byId.get(saved)?.[0]?.data["title"]).toBe(
      "Saved in the performance suite",
    );
    // The carried finding states equal a fresh check: none, as before the save.
    const { result: rechecked } = await measure(
      "workspace.check right after a save (finding states carried over, #184)",
      () => invoke("workspace.check", {}, { workspace: current }),
      { basis: "SR-020 (a check after a save; no threshold of its own)" },
    );
    expect(rechecked).toEqual({ ok: true, problems: [], checkedElements: ELEMENTS });
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);

    // Supersede a target of relations by its status (a save), then open it and one of its sources.
    const { source, target } = relationToTarget();
    await measure(
      "save one status (element.setStatus obsolete, marked invalid)",
      () => invoke("element.setStatus", { refs: [target.id], status: "obsolete" }, { workspace: current }),
      { basis: "SR-082 AK3 (the save before the open; no threshold of its own)" },
    );
    const { result: superseded, measurement: supersededOpen } = await measure(
      "open a superseded element right after a save (builds the succession index, SR-072 AK3)",
      () => openElement(current, target.id),
      { basis: "SR-082 AK3 (element.get of a superseded element after a save)", thresholdMs: OPEN_MS },
    );
    expect(superseded.status).toBe("obsolete");
    const { result: pointing, measurement: pointingOpen } = await measure(
      "open an element with a relation to a superseded element (SR-072 AK2 hint)",
      () => openElement(current, source.id),
      { basis: "SR-082 AK3 (element.get with a relation to a superseded element)", thresholdMs: OPEN_MS },
    );
    expect(pointing.problems).toContainEqual(
      expect.objectContaining({ code: "relation.target-superseded", targetId: target.id }),
    );
    expect(supersededOpen.ms, thresholdMessage(supersededOpen)).toBeLessThanOrEqual(OPEN_MS);
    expect(pointingOpen.ms, thresholdMessage(pointingOpen)).toBeLessThanOrEqual(OPEN_MS);
  });
});
