// SR-082 AK3 and AK4 in the performance suite (ADR-0011): opening an element, applying a filter and
// computing a chain in the generated workspace of N-036 with 50,000 elements and 200,000 relations.
// Opening is `element.get` (look up, read the file, element view with its hints and successors),
// without the version date, which the app asks for in a second call (recorded separately).
// The chain is `trace.chain` (SR-022) through the catalog, of the need with the largest chain, as
// its first page (spec-frage #290): the first after the start (the start builds the incoming
// relation index, `warmWorkspace`, #227), again, and right after a save (the index is carried
// over, #267). The whole chain is recorded without a threshold. The filter is a saved filter
// (SR-070) applied by name through the catalog (`element.list` with `selection.filter`, #228). The
// tests are tagged, so they assert their thresholds (ADR-0011, #215) after `measure` recorded the times.
import type { GeneratedWorkspace, HistoryCommitSpec, LargeFixtureWorkspace } from "@reqseq/testkit";
import { generateLargeWorkspace, measure, thresholdMessage, writeLargeWorkspace } from "@reqseq/testkit";
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
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import {
  buildIncomingIndex,
  elementStoreState,
  hasId,
  incomingFor,
  incomingState,
  resolveTarget,
  shortIdState,
} from "../../src/model/index.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import {
  affectedOutput,
  chainOutput,
  cyclesOf,
  derivationEdges,
  derivationGraph,
  traceAffected,
  traceChain,
  traceContext,
} from "../../src/trace/index.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK3. */
const OPEN_MS = 200;
/** SR-082 AK5: the first open after the start. */
const FIRST_OPEN_MS = 1000;
/** SR-082 AK4. */
const RESULT_MS = 500;

/** Commits of each repository's history before the generated state (opening dates a version, ADR-0005). */
const HISTORY = 1000;
/** Element files each of those commits changes. */
const CHANGED = 10;
/** Every this many commits also change the elements the AK3 tests open. */
const OPENED_EVERY = 25;

/**
 * Makes each repository a Git repository with a history like a project's: a first commit of all its
 * files, then `HISTORY` commits that each give `CHANGED` element files an earlier text (the opened
 * ones every `OPENED_EVERY` commits), and last a commit of the generated files (`git add --all`), so
 * that opening an element walks a real history (ADR-0005 "Version date"). One `git fast-import` per
 * repository builds the history (#206, #226).
 */
const writeHistory = async (
  fixture: LargeFixtureWorkspace,
  tree: GeneratedWorkspace,
): Promise<Map<string, string>> => {
  const dates = new Map<string, string>();
  const opened = new Set(
    [Math.floor(ELEMENTS / 2), Math.floor(ELEMENTS / 2) + 1].map((i) => tree.elements[i]?.id),
  );
  for (const { name, folder } of tree.repositories) {
    const prefix = `${folder}/`;
    const files = Object.fromEntries(
      [...tree.files]
        .filter(([file]) => file.startsWith(prefix))
        .map(([file, text]) => [file.slice(prefix.length), text]),
    );
    const elements = tree.elements.filter((e) => e.repository === name);
    const earlier = (file: string, commit: number): string =>
      `${String(files[file])}\nEarlier text ${String(commit)}.\n`;
    const commits: HistoryCommitSpec[] = [{ name: "start", files }];
    for (let commit = 1; commit <= HISTORY; commit++) {
      const changed = Array.from(
        { length: CHANGED },
        (_, i) => elements[(commit * 7919 + i * 104_729) % elements.length]?.file ?? "",
      );
      if (commit % OPENED_EVERY === 0) {
        changed.push(...elements.filter((e) => opened.has(e.id)).map((e) => e.file));
      }
      commits.push({
        name: String(commit),
        files: Object.fromEntries(changed.map((file) => [file, earlier(file, commit)])),
      });
    }
    await fixture.git(["init", "--quiet", "--initial-branch=main"], folder);
    await fixture.commitHistory(commits, { repository: folder, branch: "main" });
    await fixture.commit(folder, "generated");
    // The version date of every generated element: the last commit gave each its generated text back.
    const date = (await fixture.git(["log", "-1", "--format=%cI"], folder)).trim();
    dates.set(name, new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return dates;
};

describe("open, filter and chain with 50,000 elements and 200,000 relations (SR-082, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let store: ElementStore;
  let metamodel: Metamodel;
  let generatedDates = new Map<string, string>();

  beforeAll(async () => {
    // Core's versions: the stored versions are compared by workspace.check (SR-025) and must be the
    // current ones, or every relation is an outdated-relation finding.
    const version = versionOf(await standardModel());
    tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    generatedDates = await writeHistory(fixture, tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server or the app does it at start (SR-082 AK1, AK2): the adapters create the command
    // runtime (catalog and schemas) before the first call (`configureCommandRuntime`).
    getCommandRuntime();
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
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-082-cache-"));
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
   * Opening an element: `element.get`, as every access calls it (SR-080); with `versionDate`, the
   * second call of the app that asks for the date (D-013, ADR-0005).
   */
  const openElement = async (
    opened: Workspace,
    id: string,
    versionDate = false,
  ): Promise<CommandOutput<"element.get">["element"]> =>
    (
      (await invoke(
        "element.get",
        { ref: id, ...(versionDate ? { versionDate } : {}) },
        { workspace: opened },
      )) as CommandOutput<"element.get">
    ).element;

  /**
   * Opens an element as the app shows it (#542): `element.get` and the parents line, the input of
   * `parentsInput` in packages/app/src/renderer/neighbourhood.ts, at the same time. The app shows the element
   * when both have answered, so SR-082 AK3 is the time of both.
   */
  const openWithParents = async (
    opened: Workspace,
    id: string,
    repository: string,
  ): Promise<CommandOutput<"element.get">["element"]> => {
    const [element] = await Promise.all([
      openElement(opened, id),
      invoke(
        "trace.neighbourhood",
        { ref: id, repository, direction: "up", meanings: ["derivation"], allLevels: true, limit: 200 },
        { workspace: opened },
      ),
    ]);
    return element;
  };

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

  it("[SR-082/AK5] [SR-082/AK3] shows the first element after the start within 1 s, and the next one within 200 ms", async () => {
    const firstElement = tree.elements[Math.floor(ELEMENTS / 3)];
    const { result: firstView, measurement: firstOpen } = await measure(
      "open the first element after the start (look up, read its file, element view) with its parents line",
      () => openWithParents(opened(), firstElement?.id ?? "", firstElement?.repository ?? ""),
      {
        basis: "SR-082 AK5 (the first open after the start)",
        thresholdMs: FIRST_OPEN_MS,
      },
    );
    expect(firstView.id).toBe(firstElement?.id);
    expect(firstOpen.ms, thresholdMessage(firstOpen)).toBeLessThanOrEqual(FIRST_OPEN_MS);
    const element = tree.elements[Math.floor(ELEMENTS / 2)];
    const id = element?.id ?? "";
    const { result: view, measurement } = await measure(
      "open one element (look up, read its file, element view) with its parents line",
      () => openWithParents(opened(), id, element?.repository ?? ""),
      {
        basis:
          "SR-082 AK3 (element.get: store lookup, file read, element view; no git; and trace.neighbourhood up for the parents line, #542)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(view.id).toBe(id);
    expect(view.problems).toEqual([]);
    expect(view).not.toHaveProperty("versionDate");
    // The date on request, as the app asks for it in a second call: recorded, no threshold.
    const { result: dated } = await measure(
      `open one element with its version date (versionDate: true, ${String(HISTORY + 2)} commits)`,
      () => openElement(opened(), id, true),
      { basis: "D-013, ADR-0005 (element.get with versionDate; recorded, no threshold of its own)" },
    );
    expect(dated.versionDate).toBe(generatedDates.get(element?.repository ?? ""));
    expect({ ...dated, versionDate: undefined }).toEqual(view);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });

  it("[SR-082/AK4] applies a saved filter through the catalog within 500 ms (SR-070, #228)", async () => {
    // A saved filter as a team keeps it (SR-070): the system requirements still in draft, by title.
    const saved = (await invoke(
      "filter.save",
      {
        name: "Draft system requirements",
        where: { all: [{ type: ["system-requirement"] }, { status: ["draft"] }] },
        sort: [{ by: "title" }],
      },
      { workspace: opened() },
    )) as CommandOutput<"filter.save">;
    expect(saved.files).toEqual(["filters/draft-system-requirements.yaml"]);
    // Applied by name, as every access calls it (SR-080): read the filter file, compile, one pass over
    // the store, sort, build the first page.
    const { result: found, measurement } = await measure(
      "filter: a saved filter by name (system requirements with status draft, sorted by title), first page",
      async () =>
        (await invoke(
          "element.list",
          { selection: { filter: "Draft system requirements" } },
          { workspace: opened() },
        )) as CommandOutput<"element.list">,
      {
        basis: "SR-082 AK4 (element.list with selection.filter through the catalog)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(found.total).toBe(
      store.elements.filter((e) => e.type === "system-requirement" && e.data["status"] === "draft").length,
    );
    expect(found.total).toBeGreaterThan(found.elements.length);
    expect(found.elements.every((e) => e.type === "system-requirement")).toBe(true);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  type Chain = CommandOutput<"trace.chain">;

  /** `trace.chain` (SR-022) through the catalog, as every access calls it (SR-080). */
  const chainOf = async (current: Workspace, input: Readonly<Record<string, unknown>>): Promise<Chain> =>
    (await invoke("trace.chain", input, { workspace: current })) as Chain;

  /** The largest page (catalog). */
  const MAX_LIMIT = 5000;

  /**
   * The need of the largest chain: the first one the generator wrote. Nearly every element of the
   * workspace lies below it (about 42,000 nodes, 112,000 edges, 36 MB of JSON as a whole).
   */
  const firstNeed = (): string => tree.elements.find((e) => e.type === "need")?.id ?? "";

  it("[SR-082/AK4] computes a chain within 500 ms", async () => {
    const current = opened();
    const need = firstNeed();
    // The result is the first page (200 nodes by default) of the complete walk (spec-frage #290).
    // The first chain after the start: the start built the incoming relation index of the store
    // (`warmWorkspace`, #227), so the chain only walks it.
    const { result: first, measurement: firstCall } = await measure(
      "trace.chain of the first need, first page: first chain after the start (incoming index built at the start)",
      () => chainOf(current, { ref: need }),
      {
        basis:
          "SR-082 AK4 (trace.chain through the catalog, first page; the index from warmWorkspace; #227, #290)",
        thresholdMs: RESULT_MS,
      },
    );
    const { result: chain, measurement } = await measure(
      "trace.chain of the first need, first page: up and down, of every element derived from it",
      () => chainOf(current, { ref: need }),
      {
        basis: "SR-082 AK4 (trace.chain through the catalog, first page; SR-022, #227, #290)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(chain).toEqual(first);
    expect(chain.root).toBe(need);
    expect(chain.nodes).toHaveLength(200);
    expect(chain.total).toBeGreaterThan(ELEMENTS / 2);
    expect(chain.problems).toEqual([]);
    // Every repository of the generated workspace is on this machine.
    expect(chain.incomplete).toBe(false);
    // What an adapter adds and what the tests check, recorded only: the page as JSON (the API, MCP
    // and the CLI send it so) and its check against the catalog (tests and debug builds).
    await measure(
      "trace.chain of the first need, first page: the output as JSON (what an adapter sends)",
      () => JSON.stringify(chain),
      { basis: "SR-082 AK4 (serialisation by the adapter; recorded, #227)" },
    );
    const valid = getCommandRuntime().contracts.validator("trace.chain", "output");
    const { result: matches } = await measure(
      "trace.chain of the first need, first page: the output checked against the catalog schema",
      () => valid(chain),
      {
        basis:
          "SR-082 AK4 (output check of REQSEQ_VALIDATE_OUTPUT=1, tests and debug builds; recorded, #227)",
      },
    );
    expect(matches).toBe(true);
    // The whole chain, recorded so that its cost stays visible: every page of 5,000 through the
    // catalog, and the output of every node at once in core (what one page held before #290).
    const { result: pages } = await measure(
      "trace.chain of the first need: every page of 5,000 (the whole chain)",
      async () => {
        const all: Chain[] = [];
        for (let offset = 0; offset < chain.total; offset += MAX_LIMIT) {
          all.push(await chainOf(current, { ref: need, offset, limit: MAX_LIMIT }));
        }
        return all;
      },
      { basis: "SR-082 AK4 (the whole chain page by page; recorded, #227, #290)" },
    );
    expect(pages.reduce((n, page) => n + page.nodes.length, 0)).toBe(chain.total);
    const context = await traceContext(current);
    const graph = derivationGraph(context, "trace.chain");
    const [root] = context.store.byId.get(need) ?? [];
    if (root === undefined) {
      throw new Error("no first need");
    }
    const shortIds = await current.get(shortIdState);
    const { result: whole } = await measure(
      "trace.chain of the first need in core: the walks and the output of every node",
      () =>
        chainOutput(traceChain(graph, root, { direction: "both" }), { metamodel: graph.metamodel, shortIds }),
      { basis: "SR-082 AK4 (the whole chain as one result; recorded, #227, #290)" },
    );
    const { result: json } = await measure(
      "trace.chain of the first need: the whole chain as JSON",
      () => JSON.stringify(whole),
      { basis: "SR-082 AK4 (serialisation of the whole chain; recorded, #227)" },
    );
    await measure(
      `trace.chain of the first need, whole: ${String(Math.round(json.length / 1e6))} MB of JSON, ${String(whole.nodes.length)} nodes, ${String(whole.edges.length)} edges`,
      () => json.length,
      { basis: "SR-082 AK4 (size of the whole chain; recorded, #227)" },
    );
    expect(whole.nodes).toHaveLength(chain.total);
    expect(pages.reduce((n, page) => n + page.edges.length, 0)).toBe(whole.edges.length);
    const [bottom] = store.elements.filter((e) => e.type === "system-requirement").slice(-1);
    const { result: up } = await measure(
      "trace.chain upwards: every parent of the last system requirement",
      () => chainOf(current, { ref: bottom?.id ?? "", direction: "up" }),
      { basis: "SR-082 AK4 (trace.chain upwards; recorded, #227)" },
    );
    expect(up.nodes.length).toBeGreaterThan(1);
    const { result: cycles } = await measure(
      "cycles of the whole store (every derivation edge, strongly connected components)",
      () => cyclesOf(store.elements, derivationEdges(graph)),
      { basis: "SR-090 (cycles over all derivation relations; recorded, #258)" },
    );
    expect(cycles).toEqual([]);
    // What the start pays so that the first chain does not (`warmWorkspace`), once more on the same store.
    const { result: index } = await measure(
      "incoming relation index (relation kinds, relation-valued properties, references; 200,000 relations)",
      () => buildIncomingIndex(store, metamodel),
      {
        basis:
          "SR-082 AK1, AK4 (built once per store at the start, carried over a save; recorded, #227, #267)",
      },
    );
    expect(index.relationsById.size).toBeGreaterThan(0);
    expect(firstCall.ms, thresholdMessage(firstCall)).toBeLessThanOrEqual(RESULT_MS);
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
    // The first call: the incoming index of the store was built at the start (`warmWorkspace`): recorded only.
    await measure("trace.affected of the first need: first call", affectedOf, {
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
    // As an API server after a `workspace.check`: every finding state is built. The only findings:
    // the relations to the element whose text the SR-024 test above saved are outdated (SR-025).
    const changed = relationToTarget().target.id;
    const check = async (): Promise<CommandOutput<"workspace.check">> =>
      (await invoke("workspace.check", {}, { workspace: current })) as CommandOutput<"workspace.check">;
    const { result: checked } = await measure(
      "workspace.check in the loaded workspace (builds every finding state)",
      check,
      { basis: "SR-082 AK3 (the states the save carries over; no threshold of its own)" },
    );
    // Only warnings (outdated relations): ok by default (failOn error, #304).
    expect(checked.ok).toBe(true);
    expect(checked.checkedElements).toBe(ELEMENTS);
    expect(checked.problems.length).toBeGreaterThan(0);
    // Exactly the relations and references to it (17 = 10 + 7 in the generated workspace).
    const index = incomingFor(current, await current.get(elementStoreState), metamodel);
    expect(checked.problems).toHaveLength(
      (index.relationsById.get(changed)?.length ?? 0) + (index.referencesById.get(changed)?.length ?? 0),
    );
    expect(checked.problems.filter((p) => p.code !== "relation.outdated" || p.targetId !== changed)).toEqual(
      [],
    );
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
    const repository = tree.elements[Math.floor(ELEMENTS / 2) + 1]?.repository ?? "";
    const { result: view, measurement } = await measure(
      "open one element right after a save with its parents line (element.get and trace.neighbourhood on the store and short IDs as the save left them)",
      () => openWithParents(current, id, repository),
      {
        basis: "SR-082 AK3 (element.get and the parents line after a save, #184, #542)",
        thresholdMs: OPEN_MS,
      },
    );
    expect(view.id).toBe(id);
    expect(view).not.toHaveProperty("versionDate");
    expect((await current.get(elementStoreState)).byId.get(saved)?.[0]?.data["title"]).toBe(
      "Saved in the performance suite",
    );
    // The carried finding states give what the check gave before the save: the title save outdates
    // no relation here.
    const { result: rechecked } = await measure(
      "workspace.check right after a save (finding states carried over, #184)",
      check,
      { basis: "SR-020 (a check after a save; no threshold of its own)" },
    );
    expect(rechecked).toEqual(checked);
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
    const need = firstNeed();
    // The save rewrites a source of relations: its links are dropped and added again (#267).
    const { source } = relationToTarget();
    await measure(
      "save one element with relations (element.update of its title, incoming index carried)",
      () =>
        invoke("element.update", { ref: source.id, title: "Saved before a chain" }, { workspace: current }),
      { basis: "SR-082 AK4 (the save before the chain; no threshold of its own; #184, #267)" },
    );
    // The save carried the index over to the new store (#267): the chain below does not build it.
    const saved = await current.get(elementStoreState);
    expect(saved).not.toBe(before);
    expect(current.peek(incomingState)?.get(saved)?.store).toBe(saved);
    const { result: chain, measurement } = await measure(
      "trace.chain of the first need, first page, right after a save (incoming index carried, short IDs updated)",
      () => chainOf(current, { ref: need }),
      {
        basis:
          "SR-082 AK4 (trace.chain through the catalog, first page, after a save; #184, #227, #267, #290)",
        thresholdMs: RESULT_MS,
      },
    );
    const context = await traceContext(current);
    expect(context.store).not.toBe(before);
    expect(context.store.byId.get(source.id)?.[0]?.data["title"]).toBe("Saved before a chain");
    expect(context.incoming).not.toBe(indexBefore);
    expect(context.incoming.store).toBe(context.store);
    expect(chain.root).toBe(need);
    expect(chain.nodes).toHaveLength(200);
    expect(chain.total).toBeGreaterThan(ELEMENTS / 2);
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
