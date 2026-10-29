// `trace.neighbourhood` (SR-107) in the performance suite (ADR-0011) on the generated workspace of
// N-036 with 50,000 elements and 200,000 relations. The walk is always complete; only the page
// (`limit`, default 200) is built, and only the edge targets of the page get their versions. The
// default call (the direct neighbours over every kind) and the derivation chain to depth 3 assert
// SR-082 AK4's 500 ms (tagged, ADR-0011); the whole chain of the largest need and the unbounded
// walk over every kind are recorded only.
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@reqseq/testkit";
import { generateLargeWorkspace, measure, thresholdMessage, writeLargeWorkspace } from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { elementStoreState } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** The versions stored in relations do not matter here. */
const VERSION: VersionFunction = () => "n1:0000000000000000";

type Output = CommandOutput<"trace.neighbourhood">;

describe("trace.neighbourhood with 50,000 elements and 200,000 relations (SR-107, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    tree = generateLargeWorkspace({ version: VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server or the app does it at start (SR-082 AK1, AK2).
    await warmWorkspace(workspace);
    expect((await workspace.get(elementStoreState)).elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  const neighbourhood = async (input: Record<string, unknown>): Promise<Output> => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return (await invoke("trace.neighbourhood", input, { workspace })) as Output;
  };

  const firstNeed = (): string => tree.elements.find((e) => e.type === "need")?.id ?? "";

  it("[SR-082/AK4] gives the first page of the direct neighbours over every kind within 500 ms", async () => {
    // The incoming relation index and the short IDs are built once per store, not per call (ADR-0008).
    await neighbourhood({ ref: firstNeed() });
    const { result, measurement } = await measure(
      "neighbourhood: first page (200) of the direct neighbours of the first need, every kind",
      () => neighbourhood({ ref: firstNeed() }),
      {
        basis: "SR-082 AK4 (trace.neighbourhood, the walk complete, one page built)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(result.nodes.length).toBeGreaterThan(1);
    expect(result.total).toBe(result.nodes.length);
    expect(result.incomplete).toBe(false);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] gives the first page of the derivation chain to depth 3 within 500 ms", async () => {
    const { result, measurement } = await measure(
      "neighbourhood: first page (200) of the derivations of the first need to depth 3",
      () => neighbourhood({ ref: firstNeed(), meanings: ["derivation"], maxDepth: 3 }),
      {
        basis: "SR-082 AK4 (trace.neighbourhood, derivations only, the walk complete)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(result.nodes).toHaveLength(200);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  // The whole chain of the largest need (about 42,000 nodes) is over 500 ms for trace.chain too
  // (core README, trace block; #227), so it is recorded, not asserted.
  it("records the whole derivation chain of the first need", async () => {
    const { result } = await measure(
      "neighbourhood: first page (200) of the whole derivation chain of the first need",
      () => neighbourhood({ ref: firstNeed(), meanings: ["derivation"], allLevels: true }),
      { basis: "SR-107, #227 (recorded; compare trace.chain)" },
    );
    expect(result.total).toBeGreaterThan(200);
  });

  it("records the unbounded walk over every kind", async () => {
    const { result } = await measure(
      "neighbourhood: first page (200) of the walk over every kind and level of the first need",
      () => neighbourhood({ ref: firstNeed(), allLevels: true }),
      { basis: "SR-107 (recorded)" },
    );
    expect(result.total).toBeGreaterThan(0);
  });
});
