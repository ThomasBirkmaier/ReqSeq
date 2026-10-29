// `trace.matrix` (SR-125) in the performance suite (ADR-0011) on the generated workspace of N-036
// with 50,000 elements and 200,000 relations. The columns and their counts take the whole selection
// (one pass over the records and the incoming index, no file); only the page (`limit`, default 200)
// gets its cells, and only its rows and their available targets get their versions. The first page
// of all elements in the sort of the app's list, and of all system requirements, assert SR-082
// AK4's 500 ms (tagged, ADR-0011) after a warm-up call (the incoming index is built on the first
// call); the derivation tree of all elements and a page of hubs (decisions, whose cells hold many
// relations) are recorded only.
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@reqseq/testkit";
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

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** Runs of an asserted time; the median counts. */
const RUNS = 5;
/** The versions stored in relations are all the same, so every relation to an element is outdated. */
const VERSION: VersionFunction = () => "n1:0000000000000000";
/** The sort of the app's list when it has none of its own (`DEFAULT_SORT`, packages/app). */
const APP_SORT = [
  { by: "type", order: "asc" },
  { by: "identifier", order: "asc" },
];

type Output = CommandOutput<"trace.matrix">;

describe("trace.matrix with 50,000 elements and 200,000 relations (SR-125, N-036)", () => {
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

  const matrix = async (input: Record<string, unknown>): Promise<Output> => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return (await invoke("trace.matrix", input, { workspace })) as Output;
  };

  const basis = "SR-125, N-036 (recorded; compare SR-082 AK4, 500 ms)";

  it("[SR-082/AK4] gives the first page of all elements in the app's sort within 500 ms", async () => {
    // The incoming relation index and the short IDs are built once per store, not per call (ADR-0008).
    await matrix({ sort: APP_SORT });
    const { result, measurement } = await measureMedian(
      "matrix: first page (200) of all 50,000 elements, columns over the whole selection, the app's sort",
      () => matrix({ sort: APP_SORT }),
      {
        basis: "SR-082 AK4 (trace.matrix, columns over the selection, one page built)",
        thresholdMs: RESULT_MS,
        runs: RUNS,
      },
    );
    expect(result.total).toBe(ELEMENTS);
    expect(result.rows).toHaveLength(200);
    expect(result.columns.length).toBeGreaterThan(2);
    expect(result.columns.every((c) => c.count > 0 && c.share === c.count / ELEMENTS)).toBe(true);
    expect(result.incomplete).toBe(false);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] gives the first page of all system requirements within 500 ms", async () => {
    const input = { selection: { where: { type: ["system-requirement"] } }, sort: APP_SORT };
    await matrix(input);
    const { result, measurement } = await measureMedian(
      "matrix: first page (200) of all system requirements, columns over the whole selection",
      () => matrix(input),
      {
        basis: "SR-082 AK4 (trace.matrix, columns over the selection, one page built)",
        thresholdMs: RESULT_MS,
        runs: RUNS,
      },
    );
    expect(result.total).toBeGreaterThan(200);
    expect(result.rows).toHaveLength(200);
    expect(result.columns.map((c) => `${c.kind}/${c.direction}`)).toContain("derives-from/out");
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records the first page of all elements as a derivation tree", async () => {
    const { result } = await measure(
      "matrix: first page (200) of all 50,000 elements as a derivation tree",
      () => matrix({ sort: [{ by: "hierarchy" }] }),
      { basis },
    );
    expect(result.rows.every((r) => r.depth !== undefined)).toBe(true);
  });

  it("records the first page of the decisions, whose cells hold many relations", async () => {
    const { result } = await measure(
      "matrix: first page (200) of all decisions, many incoming relations per cell, all outdated",
      () => matrix({ selection: { where: { type: ["decision"] } }, sort: APP_SORT }),
      { basis },
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.flatMap((r) => r.cells.flat()).some((l) => l.outdated === true)).toBe(true);
  });
});
