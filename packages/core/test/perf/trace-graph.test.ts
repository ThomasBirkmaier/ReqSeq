// `trace.graph` (SR-111) in the performance suite (ADR-0011) on the generated workspace of N-036 with
// 50,000 elements and 200,000 relations. Each walk stops once it has reached `limit` elements (500,
// the size of SR-111 AK6), so the calls the app sends assert SR-082 AK4's 500 ms (tagged, ADR-0011):
// the direct neighbours, the whole derivation chain, the whole chain over every kind (about 42,000
// elements without the bound) and the package with the most members at depth 1 (the hub). The core
// part of a graph of 500 nodes is recorded as well: SR-111 AK6 leaves the rest of its second to the
// layout in the app. Most of it is the `outdated` mark: the current versions of the link targets of
// every node (about 2,600 files for 500 nodes), read from their files while the workspace has not
// built the versions of the whole store (no warm-up builds them).
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measure,
  measureMedian,
  thresholdMessage,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { elementStoreState } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** SR-111 AK6. */
const NODES = 500;

type Output = CommandOutput<"trace.graph">;

describe("trace.graph with 50,000 elements and 200,000 relations (SR-111, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  /** The package most elements name under `packages`, and how many do. */
  let hub = { id: "", members: 0 };

  beforeAll(async () => {
    // Core's versions: no link is outdated, so the `outdated` mark needs the version of every target.
    const version = versionOf(await standardModel());
    tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server or the app does it at start (SR-082 AK1, AK2).
    await warmWorkspace(workspace);
    const store = await workspace.get(elementStoreState);
    expect(store.elements).toHaveLength(ELEMENTS);
    const members = new Map<string, number>();
    for (const element of store.elements) {
      const packages: unknown = element.data["packages"];
      for (const item of Array.isArray(packages) ? (packages as unknown[]) : []) {
        const id = (item as { readonly id?: unknown } | null)?.id;
        if (typeof id === "string") {
          members.set(id, (members.get(id) ?? 0) + 1);
        }
      }
    }
    for (const [id, count] of members) {
      if (count > hub.members) {
        hub = { id, members: count };
      }
    }
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  const graph = async (input: Record<string, unknown>): Promise<Output> => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return (await invoke("trace.graph", input, { workspace })) as Output;
  };

  const firstNeed = (): string => tree.elements.find((e) => e.type === "need")?.id ?? "";

  it("[SR-082/AK4] gives the direct neighbours of a need over every kind within 500 ms", async () => {
    // The incoming relation index and the short IDs are built once per store, not per call (ADR-0008).
    await graph({ ref: firstNeed() });
    const { result, measurement } = await measure(
      "graph: the direct neighbours of the first need, every kind (limit 500)",
      () => graph({ ref: firstNeed() }),
      { basis: "SR-082 AK4 (trace.graph, depth 1)", thresholdMs: RESULT_MS },
    );
    expect(result.nodes.length).toBeGreaterThan(1);
    expect(result.incomplete).toBe(false);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] gives 500 nodes of the whole derivation chain of a need within 500 ms", async () => {
    const { result, measurement } = await measure(
      "graph: the whole derivation chain of the first need (limit 500)",
      () => graph({ ref: firstNeed(), allLevels: true, meanings: ["derivation"] }),
      { basis: "SR-082 AK4 (trace.graph, the walks bounded by limit)", thresholdMs: RESULT_MS },
    );
    expect([result.nodes.length, result.truncated]).toEqual([NODES, true]);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] gives 500 nodes of the whole chain of a need over every kind within 500 ms", async () => {
    const { result, measurement } = await measure(
      "graph: the whole chain of the first need over every kind (limit 500)",
      () => graph({ ref: firstNeed(), allLevels: true }),
      { basis: "SR-082 AK4 (trace.graph, Whole chain with every kind)", thresholdMs: RESULT_MS },
    );
    expect([result.nodes.length, result.truncated]).toEqual([NODES, true]);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] gives the package with the most members at depth 1 within 500 ms", async () => {
    expect(hub.members).toBeGreaterThan(100);
    const { result, measurement } = await measure(
      `graph: the package with the most members (${String(hub.members)}) at depth 1 (limit 500)`,
      () => graph({ ref: hub.id }),
      { basis: "SR-082 AK4 (trace.graph, a hub)", thresholdMs: RESULT_MS },
    );
    expect(result.nodes.length).toBeGreaterThan(100);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records the core part of a graph of 500 nodes (SR-111 AK6)", async () => {
    const { result } = await measureMedian(
      "graph: core part of a graph of 500 nodes (whole chain of the first need, every kind), median of 5",
      () => graph({ ref: firstNeed(), allLevels: true }),
      { basis: "SR-111 AK6 (recorded; the app lays the graph out within the rest of 1 s)", runs: 5 },
    );
    expect(result.nodes).toHaveLength(NODES);
  });
});
