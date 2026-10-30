// The view rule (SR-041, SR-042, SR-043) in the performance suite (ADR-0011, stage 5 plan VR-S6):
// the generated workspace of N-036 (50,000 elements, 200,000 relations) with the variant rules pass
// of the testkit (`variantRules`: 100 variants, 5,000 exclusions and 5,000 replacements, about
// 210,000 relations in all) and the evidence records of `withEvidenceRecords`.
//
// - Tagged `[SR-082/AK4]` and asserted at 500 ms: `element.list` with a filter and `trace.chain`,
//   each in the view of the variant that removes the most core requirements, the first call after
//   the start (it builds the view rule index of the store) and again.
// - Tagged `[SR-098/AK1]` and asserted at 300 ms (quality goal 3): `element.search` in that view, the
//   median of 7 runs as search-speed.test.ts does.
// - `evidence.coverage` and `evidence.status` (indirect, the top requirements) in that view: recorded
//   with AK4's 500 ms for comparison only (spec question #693, as evidence.test.ts).
// - The first filter is the first command in a view (the asserted cold row: it builds the view rule
//   index and its removal map). Recorded: that build once more on the same store with the code warmed,
//   and what follows `variant.exclude`: the new store's index and the status state rebuilt (the
//   changed variant record fails `sameViews` in verification.ts).
//
// The tests check the view against an oracle written from the element data here, not with the rule.
import type { GeneratedEvidence, GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measure,
  measureMedian,
  thresholdMessage,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandName, CommandOutput } from "../../src/catalog.js";
import { evidenceIndexState } from "../../src/evidence/index.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import type { ElementRecord, ElementStore } from "../../src/model/index.js";
import { elementStoreState } from "../../src/model/index.js";
import { searchIndex } from "../../src/query/search-state.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { buildViewRuleIndex, removersOf } from "../../src/variants/view-rule.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** Quality goal 3, SR-098 AK1. */
const SEARCH_MS = 300;
const SEARCH_RUNS = 7;
const COMPARE_AK4 = "untagged; threshold for comparison only (#693)";
const COMPARED = { thresholdMs: RESULT_MS } as const;
const REQUIREMENT = "system-requirement";

type Output<K extends CommandName> = CommandOutput<K>;

/** The UUIDs the relation items of `key` in `record` name. */
const targetIds = (record: ElementRecord, key: string): string[] => {
  const items: unknown = record.data[key];
  return (Array.isArray(items) ? (items as unknown[]) : []).flatMap((item) => {
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  });
};

/**
 * The view of `variant` from the element data (SR-043 AK1): requirements whose validity names it,
 * core requirements it neither excludes nor has replaced by one of those, every other element.
 * Every rule item of the generator names a core requirement of this workspace.
 */
const oracleOf = (store: ElementStore, variant: string): ((e: ElementRecord) => boolean) => {
  const removed = new Set<string>();
  for (const e of store.elements) {
    if (e.id === variant) {
      targetIds(e, "excludes").forEach((id) => removed.add(id));
    } else if (targetIds(e, "validity").includes(variant)) {
      targetIds(e, "replaces").forEach((id) => removed.add(id));
    }
  }
  return (e) => {
    if (e.type !== REQUIREMENT) {
      return true;
    }
    const validity = targetIds(e, "validity");
    return validity.length === 0 ? !removed.has(e.id) : validity.includes(variant);
  };
};

describe("the view of a variant with 50,000 elements, 5,000 exclusions and 5,000 replacements (SR-082, SR-043, N-036)", () => {
  let tree: GeneratedWorkspace;
  let evidence: GeneratedEvidence;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let cacheFolder = "";
  let store: ElementStore;
  let metamodel: Metamodel;
  /** The variant that removes the most core requirements, and its oracle. */
  let variant = "";
  let inView: (e: ElementRecord) => boolean = () => false;

  const ws = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };

  const run = async <K extends CommandName>(
    command: K,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Output<K>> => (await invoke(command, input, { workspace: ws() })) as Output<K>;

  /** The draft system requirements by title, as open-filter-chain.test.ts filters, in `variant`'s view. */
  const filter = (): Readonly<Record<string, unknown>> => ({
    selection: { view: variant, where: { all: [{ type: [REQUIREMENT] }, { status: ["draft"] }] } },
    sort: [{ by: "title" }],
  });
  /** Whether the element with UUID `id` of the store before any change is in the view (oracle). */
  const idInView = (id: string): boolean => {
    const element = store.byId.get(id)?.[0];
    return element !== undefined && inView(element);
  };
  const draftsInView = (now: ElementStore): number =>
    now.elements.filter((e) => e.type === REQUIREMENT && e.data["status"] === "draft" && inView(e)).length;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS, variantRules: {} });
    evidence = withEvidenceRecords(tree);
    fixture = await writeLargeWorkspace(evidence.workspace);
    cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-variant-cache-"));
    workspace = new Workspace(fixture.workspaceRoot, { cacheFolder });
    // A warm server (SR-082): the model, the search index ready, the evidence files read.
    getCommandRuntime();
    await warmWorkspace(workspace, 0);
    await searchIndex(workspace);
    await workspace.get(evidenceIndexState);
    store = await workspace.get(elementStoreState);
    metamodel = await workspace.get(metamodelState);
    expect(store.elements).toHaveLength(ELEMENTS);
    expect([tree.exclusions, tree.replacements]).toEqual([5000, 5000]);
    const variants = store.elements.filter((e) => e.type === "variant");
    expect(variants).toHaveLength(100);
    const sizes = variants.map((v) => {
      const oracle = oracleOf(store, v.id);
      return {
        id: v.id,
        out: store.elements.filter((e) => targetIds(e, "validity").length === 0 && !oracle(e)).length,
      };
    });
    const largest = sizes.reduce((a, b) => (b.out > a.out ? b : a));
    variant = largest.id;
    inView = oracleOf(store, variant);
    expect(largest.out).toBeGreaterThan(50);
  }, 900_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
    await fs.rm(cacheFolder, { recursive: true, force: true });
  });

  it("[SR-082/AK4] applies a filter in the view of a variant within 500 ms (SR-043 AK3)", async () => {
    const { result: cold, measurement: first } = await measure(
      "filter in the view of a variant (draft system requirements by title), first page: first after the start (builds the view rule index)",
      () => run("element.list", filter()),
      {
        basis: "SR-082 AK4, SR-043 AK3 (element.list with selection.view and where)",
        thresholdMs: RESULT_MS,
      },
    );
    const { result: warm, measurement } = await measure(
      "filter in the view of a variant (draft system requirements by title), first page: again",
      () => run("element.list", filter()),
      {
        basis: "SR-082 AK4, SR-043 AK3 (element.list with selection.view and where)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(warm).toEqual(cold);
    expect(warm.total).toBe(draftsInView(store));
    expect(warm.total).toBeLessThan(
      store.elements.filter((e) => e.type === REQUIREMENT && e.data["status"] === "draft").length,
    );
    expect(warm.elements.every((e) => e.type === REQUIREMENT)).toBe(true);
    expect(first.ms, thresholdMessage(first)).toBeLessThanOrEqual(RESULT_MS);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records the build of the view rule index and its removal map once more, on the same store", async () => {
    const { result: index } = await measure(
      "view rule index: built from the store (exclusion and replacement items of 50,000 elements; code warmed by the first filter)",
      () => buildViewRuleIndex(store, metamodel),
      {
        basis:
          "SR-043, stage 5 plan VR-S6 (what the first command in a view pays per store, here after the first filter warmed the code; recorded)",
      },
    );
    expect(index.items).toHaveLength(tree.exclusions + tree.replacements);
    const first = store.elements.find((e) => e.type === REQUIREMENT);
    if (first === undefined) {
      throw new Error("no system requirement");
    }
    await measure(
      "view rule index: removal map (the variants that remove each core requirement; code warmed)",
      () => removersOf(index, first),
      { basis: "SR-043, stage 5 plan VR-S6 (built on the first `includes`; recorded)" },
    );
  });

  it("[SR-082/AK4] computes a chain in the view of a variant within 500 ms (SR-043 AK4)", async () => {
    // The need of the largest chain (open-filter-chain.test.ts): the first one the generator wrote.
    const need = tree.elements.find((e) => e.type === "need")?.id ?? "";
    const { result: first, measurement: firstCall } = await measure(
      "trace.chain of the first need in the view of a variant, first page: first chain in the view",
      () => run("trace.chain", { ref: need, view: variant }),
      { basis: "SR-082 AK4, SR-043 AK4 (trace.chain with view, first page)", thresholdMs: RESULT_MS },
    );
    const { result: chain, measurement } = await measure(
      "trace.chain of the first need in the view of a variant, first page: again",
      () => run("trace.chain", { ref: need, view: variant }),
      { basis: "SR-082 AK4, SR-043 AK4 (trace.chain with view, first page)", thresholdMs: RESULT_MS },
    );
    const { result: whole } = await measure(
      "trace.chain of the first need without a view, first page (for comparison)",
      () => run("trace.chain", { ref: need }),
      { basis: "SR-082 AK4 (trace.chain without view; recorded)" },
    );
    expect(chain).toEqual(first);
    expect(chain.nodes).toHaveLength(200);
    expect(chain.incomplete).toBe(false);
    expect(chain.total).toBeLessThan(whole.total);
    expect(chain.nodes.every((n) => idInView(n.id))).toBe(true);
    expect(firstCall.ms, thresholdMessage(firstCall)).toBeLessThanOrEqual(RESULT_MS);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-098/AK1] shows the first hits of a search in the view of a variant within 300 ms, median of 7 (SR-043 AK2)", async () => {
    // A requirement of the variant itself, from the middle of the store: its title names it alone.
    const own = store.elements
      .slice(ELEMENTS / 2)
      .find((e) => e.type === REQUIREMENT && targetIds(e, "validity").includes(variant));
    if (own === undefined) {
      throw new Error("no requirement of the variant");
    }
    for (const [what, query, expected] of [
      ["a word of every text", "station", undefined],
      ["a whole title of a requirement of the variant", String(own.data["title"]), own.id],
    ] as const) {
      const { result, measurement } = await measureMedian(
        `element.search in the view of a variant: ${what} (${query}), first page of 50`,
        () => run("element.search", { query, selection: { view: variant } }),
        {
          basis:
            "SR-098 AK1, quality goal 3, SR-043 AK2 (element.search with selection.view; median of 7 runs)",
          thresholdMs: SEARCH_MS,
          runs: SEARCH_RUNS,
        },
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.every((e) => idInView(e.id))).toBe(true);
      if (expected !== undefined) {
        expect(result.hits.map((e) => e.id)).toContain(expected);
      }
      expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(SEARCH_MS);
    }
  });

  /** Coverage of the system requirements and the status page of the top requirements, in the view. */
  const coverage = (view?: string) =>
    run("evidence.coverage", {
      selection: { ...(view === undefined ? {} : { view }), where: { type: [REQUIREMENT] } },
    });
  const status = () =>
    run("evidence.status", { selection: { view: variant, ids: evidence.parents.slice(0, 200) }, limit: 200 });

  it("records evidence.coverage and evidence.status indirect in the view of a variant (#693)", async () => {
    const { result: cold } = await measure(
      "evidence.coverage of the system requirements in the view of a variant: first after the start",
      () => coverage(variant),
      { basis: `SR-043 AK5 (cold; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: warm } = await measure(
      "evidence.coverage of the system requirements in the view of a variant: again",
      () => coverage(variant),
      { basis: `SR-043 AK5 (warm; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: all } = await measure(
      "evidence.coverage of the system requirements without a view (for comparison)",
      () => coverage(),
      { basis: `SR-036 (warm; ${COMPARE_AK4})`, ...COMPARED },
    );
    expect(warm).toEqual(cold);
    expect(warm.levels[0]?.total).toBe(
      store.elements.filter((e) => e.type === REQUIREMENT && inView(e)).length,
    );
    expect(warm.levels[0]?.total).toBeLessThan(all.levels[0]?.total ?? 0);
    const { result: first } = await measure(
      "evidence.status of 200 top system requirements (indirect) in the view of a variant: first after the start",
      status,
      { basis: `SR-043 AK7, SR-034 (cold; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: again } = await measure(
      "evidence.status of 200 top system requirements (indirect) in the view of a variant: again",
      status,
      { basis: `SR-043 AK7, SR-034 (warm; ${COMPARE_AK4})`, ...COMPARED },
    );
    expect(again).toEqual(first);
    expect(again.elements.length).toBeGreaterThan(100);
    expect(again.elements.every((e) => (e.verification?.length ?? 0) > 0)).toBe(true);
  });

  it("records the store update, the view rule index and the status state after variant.exclude", async () => {
    const before = draftsInView(store);
    const target = store.elements.find(
      (e) =>
        e.type === REQUIREMENT &&
        e.data["status"] === "draft" &&
        targetIds(e, "validity").length === 0 &&
        inView(e),
    );
    if (target === undefined) {
      throw new Error("no core requirement in the view");
    }
    const { result: excluded } = await measure(
      "variant.exclude of one core requirement (the variant file written, the store updated)",
      () => run("variant.exclude", { variant, refs: [target.id] }),
      { basis: "SR-042 AK1 (recorded)" },
    );
    expect(excluded.files).toHaveLength(1);
    const now = await ws().get(elementStoreState);
    expect(now).not.toBe(store);
    inView = oracleOf(now, variant);
    const { result: list } = await measure(
      "filter in the view of a variant, first page: right after variant.exclude (view rule index of the new store)",
      () => run("element.list", filter()),
      { basis: `SR-082 AK4, SR-042 (after a change; ${COMPARE_AK4})`, ...COMPARED },
    );
    expect(list.total).toBe(before - 1);
    expect(list.total).toBe(draftsInView(now));
    await measure(
      "evidence.coverage of the system requirements in the view of a variant: right after variant.exclude",
      () => coverage(variant),
      { basis: `SR-042 AK3, SR-043 AK5 (after a change; ${COMPARE_AK4})`, ...COMPARED },
    );
    const { result: rebuilt } = await measure(
      "evidence.status of 200 top system requirements in the view of a variant: right after variant.exclude (status state rebuilt, sameViews)",
      status,
      { basis: `SR-043 AK7 (after a change; ${COMPARE_AK4})`, ...COMPARED },
    );
    expect(rebuilt.elements.length).toBeGreaterThan(100);
  });
});
