// SR-082 AK3 and AK4 in the performance suite (ADR-0011): opening an element, applying a filter and
// computing a chain in the generated workspace of N-036 with 50,000 elements and 200,000 relations.
// Opening is `element.get` (look up, read the file, element view with its hints and successors).
// Stage 1 has no filter language (SR-070, stage 3) and no chain (SR-022, stage 2), so these are
// measured at the lowest level core has (#127, option 1): they run on the in-memory store, and the
// chain on the model's incoming relation index and the derivation walk of the trace block (#258,
// ADR-0008); the index is carried over a save (#267), so a chain right after one stays within the
// threshold too. Later stages add tests of their commands with the same tags (`trace.chain`: #227). The tests are tagged, so they assert their thresholds (ADR-0011, #215) after
// `measure` recorded the times.
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, measure, thresholdMessage, writeLargeWorkspace } from "@logreq/testkit";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RACY_MS, serializeModelCache } from "../../src/model/model-cache.js";
import type { LoadedStore, StoreUpdate } from "../../src/model/store.js";
import { storeUpdate } from "../../src/model/store.js";
import { CARRY_LIMIT, carryIncomingIndex } from "../../src/model/incoming.js";
import { canonicalRoot, writeCacheFile } from "../../src/workspace/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import type { ElementRecord, ElementStore, IncomingLink } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import {
  buildIncomingIndex,
  elementStoreState,
  hasId,
  incomingFor,
  resolveTarget,
  shortIdState,
  titleKeyOf,
  warmWorkspace,
} from "../../src/model/index.js";
import { Workspace } from "../../src/runtime/workspace.js";
import {
  affectedOutput,
  cyclesOf,
  derivationEdges,
  derivationGraph,
  traceAffected,
  traceContext,
  walkDerivation,
} from "../../src/trace/index.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK3. */
const OPEN_MS = 200;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** The versions stored in relations do not matter here: nothing compares them. */
const VERSION: VersionFunction = () => "n1:0000000000000000";

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
    const need = tree.elements.find((e) => e.type === "need");
    const [top] = store.byId.get(need?.id ?? "") ?? [];
    const [bottom] = store.elements.filter((e) => e.type === "system-requirement").slice(-1);
    if (top === undefined || bottom === undefined) {
      throw new Error("the generated workspace has no need or no system requirement");
    }
    const layout = await opened().get(workspaceLayoutState);
    // Built once per element store in the model (`incomingFor`, ADR-0008), not per chain, and carried
    // over a save (#267): recorded only, about 0.25 to 0.45 s here. The workspace keeps it, so the
    // chain after a save below finds it carried.
    const { result: incoming } = await measure(
      "incoming relation index (relation kinds, relation-valued properties, references; 200,000 relations)",
      () => incomingFor(opened(), store, metamodel),
      { basis: "SR-082 AK4 (built once per element store, not per chain; ADR-0008, #258)" },
    );
    const graph = derivationGraph({ layout, metamodel, store, incoming }, "trace.chain");
    const { result: chain, measurement } = await measure(
      "chain: every element derived from the first need",
      () => walkDerivation(graph, [top], { direction: "down" }),
      {
        basis: "SR-082 AK4 (core: derivation walk over the incoming index; #127, #258)",
        thresholdMs: RESULT_MS,
      },
    );
    const { result: up } = await measure(
      "chain upwards: every parent of the last system requirement",
      () => walkDerivation(graph, [bottom], { direction: "up" }),
      { basis: "SR-082 AK4 (core: derivation walk upwards; recorded, #258)" },
    );
    const { result: cycles } = await measure(
      "cycles of the whole store (every derivation edge, strongly connected components)",
      () => cyclesOf(store.elements, derivationEdges(graph)),
      { basis: "SR-090 (cycles over all derivation relations; recorded, #258)" },
    );
    expect(cycles).toEqual([]);
    expect(graph.kinds.map((k) => k.key)).toEqual(expect.arrayContaining(["refines", "derives-from"]));
    expect(chain.nodes[0]?.element).toBe(top);
    expect(chain.nodes.length).toBeGreaterThan(1);
    expect(up.nodes.length).toBeGreaterThan(1);
    // Every repository of the generated workspace is on this machine.
    expect(chain.incomplete).toBe(false);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records the carry of the incoming index over a change of CARRY_LIMIT elements (#273, no threshold)", async () => {
    const index = incomingFor(opened(), store, metamodel);
    // A change that rewrote every `step`-th element in place (the same content, new records), as
    // `updateElements` gives it; nothing is written.
    const step = Math.floor(ELEMENTS / CARRY_LIMIT);
    const chosen = store.elements.filter((_, i) => i % step === 0).slice(0, CARRY_LIMIT);
    const copies = new Map(chosen.map((record) => [record, { ...record }]));
    const to: ElementStore = {
      ...store,
      elements: store.elements.map((record) => copies.get(record) ?? record),
      byId: new Map([...store.byId].map(([id, records]) => [id, records.map((r) => copies.get(r) ?? r)])),
    };
    const files = new Map<string, Set<string>>();
    for (const { repository, file } of chosen) {
      files.set(repository, (files.get(repository) ?? new Set()).add(file));
    }
    const update: StoreUpdate = {
      from: store,
      to,
      files,
      ids: new Set(chosen.map((record) => record.id)),
      repositories: (store as LoadedStore).repositories,
    };
    expect(update.ids.size).toBe(CARRY_LIMIT);
    const { result: carried } = await measure(
      `carry the incoming index over a change of ${String(CARRY_LIMIT)} elements (the limit, #273)`,
      () => carryIncomingIndex(index, update),
      { basis: "SR-082 AK4 (the largest carry inside a store change; against the build above, #273)" },
    );
    expect(carried.relationsById.size).toBe(index.relationsById.size);
  });

  it("[SR-082/AK4] computes the affected elements of the first need within 500 ms (SR-024)", async () => {
    const current = opened();
    const need = tree.elements.find((e) => e.type === "need")?.id ?? "";
    type Affected = CommandOutput<"trace.affected">;
    const affectedOf = async (): Promise<Affected> =>
      (await invoke("trace.affected", { ref: need }, { workspace: current })) as Affected;
    // The first call builds the incoming index of the store (`incomingFor`, once per store, as for
    // the chain above): recorded only.
    await measure("trace.affected of the first need, with the incoming index built on the way", affectedOf, {
      basis: "SR-024 AK1 (N-036; the index once per store; recorded)",
    });
    const { result: affected, measurement } = await measure(
      "trace.affected of the first need (first page of 200, incoming index built before)",
      affectedOf,
      { basis: "SR-082 AK4 (trace.affected, SR-024 AK1, on the incoming index)", thresholdMs: RESULT_MS },
    );
    // Nearly the whole workspace lies below the first need.
    expect(affected.total).toBeGreaterThan(ELEMENTS / 2);
    expect(affected.affected).toHaveLength(200);
    expect(affected.incomplete).toBe(false);
    // The parts: the walk, and the output of one page and of every affected element.
    const graph = derivationGraph(await traceContext(current), "trace.affected");
    const [start] = graph.store.byId.get(need) ?? [];
    if (start === undefined) {
      throw new Error("no first need");
    }
    const { result: walked } = await measure(
      "affected elements of the first need: the walk (core)",
      () => traceAffected(graph, start),
      { basis: "SR-024 AK1 (N-036; recorded)" },
    );
    const context = { metamodel: graph.metamodel, shortIds: await current.get(shortIdState) };
    await measure(
      "affected elements of the first need: the output of every one (short IDs, titles, ways)",
      () => affectedOutput(walked, context, { limit: walked.reached.size, offset: 0 }),
      { basis: "SR-024 AK1 (N-036; recorded; a page holds at most 5,000)" },
    );
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  // Before the tests after a save: it saves the text of one element twice.
  it("records two content saves in a row that count the affected elements (SR-024 AK2, #273)", async () => {
    const current = opened();
    const { target } = relationToTarget();
    const save = (text: string): Promise<CommandOutput<"element.update">> =>
      invoke("element.update", { ref: target.id, text }, { workspace: current }) as Promise<
        CommandOutput<"element.update">
      >;
    // The incoming index of this store was built by trace.affected above.
    const { result: first } = await measure(
      "content save that counts the affected elements (incoming index of the store built before)",
      () => save("Changed in the performance suite.\n"),
      { basis: "SR-024 AK2 (N-036; recorded)" },
    );
    // The save replaced the store and carried the incoming index over (#273): no build again.
    const { result: second } = await measure(
      "second content save right after a save (incoming index carried over the first, #273)",
      () => save("Changed again in the performance suite.\n"),
      { basis: "SR-024 AK2 (N-036; recorded)" },
    );
    expect(second.affected).toBe(first.affected);
    expect(first.affected).toBeGreaterThan(0);
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
      "open a superseded element right after a save (successors from the carried incoming index, SR-072 AK3, #272)",
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

  // After the test above: it changes a file too.
  it("[SR-082/AK4] computes a chain within 500 ms right after a save", async () => {
    const current = opened();
    // As a server after a first chain: the incoming index of the store is built.
    const { store: before, incoming: indexBefore } = await traceContext(current);
    const top = before.elements.find((e) => e.type === "need");
    if (top === undefined) {
      throw new Error("the generated workspace has no need");
    }
    // The save rewrites a source of relations: its links are dropped and added again (#267).
    const { source } = relationToTarget();
    await measure(
      "save one element with relations (element.update of its title, incoming index carried)",
      () =>
        invoke("element.update", { ref: source.id, title: "Saved before a chain" }, { workspace: current }),
      { basis: "SR-082 AK4 (the save before the chain; no threshold of its own; #184, #267)" },
    );
    const { result, measurement } = await measure(
      "chain right after a save: every element derived from the first need (incoming index carried)",
      async () => {
        // `trace.chain` (SR-022) is not in the catalog yet: as in the chain test above.
        const context = await traceContext(current);
        const graph = derivationGraph(context, "workspace.check");
        return { context, chain: walkDerivation(graph, [top], { direction: "down" }) };
      },
      {
        basis:
          "SR-082 AK4 (core: trace context with the carried index and derivation walk after a save; #267)",
        thresholdMs: RESULT_MS,
      },
    );
    const { context, chain } = result;
    expect(context.store).not.toBe(before);
    expect(context.store.byId.get(source.id)?.[0]?.data["title"]).toBe("Saved before a chain");
    expect(context.incoming).not.toBe(indexBefore);
    expect(context.incoming.store).toBe(context.store);
    expect(chain.nodes[0]?.element).toBe(top);
    expect(chain.nodes.length).toBeGreaterThan(1);
    // The carried index equals a fresh build of the same store: every list, link by link.
    const fresh = buildIncomingIndex(context.store, context.metamodel);
    const same = (a: IncomingLink | undefined, b: IncomingLink): boolean =>
      a?.source === b.source &&
      (a.kind === "relation"
        ? b.kind === "relation" &&
          a.key === b.key &&
          a.index === b.index &&
          a.item === b.item &&
          a.repository === b.repository
        : b.kind === "reference" && a.reference === b.reference);
    let differing = 0;
    for (const [carried, built] of [
      [context.incoming.relationsById, fresh.relationsById],
      [context.incoming.referencesById, fresh.referencesById],
    ] as const) {
      expect(carried.size).toBe(built.size);
      for (const [id, links] of built) {
        const kept: readonly IncomingLink[] = carried.get(id) ?? [];
        if (kept.length !== links.length || links.some((link, i) => !same(kept[i], link))) {
          differing += 1;
        }
      }
    }
    expect(differing).toBe(0);
    // What the save paid for it: the carry alone, once more on the same change.
    const update = storeUpdate(before, context.store);
    if (update === undefined) {
      throw new Error("the save gave no store update");
    }
    const { result: again } = await measure(
      "carry the incoming index over a save of one element (part of the save, #267)",
      () => carryIncomingIndex(indexBefore, update),
      { basis: "SR-082 AK4 (what a save pays to keep the index; recorded, #267)" },
    );
    expect(again.relationsById.size).toBe(fresh.relationsById.size);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });
});
