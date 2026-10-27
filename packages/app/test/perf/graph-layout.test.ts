// The layout part of SR-111 AK6 in the performance suite (ADR-0011), on the generated workspace of N-036
// with 50,000 elements and 200,000 relations: the app's layout (`graph-layout.ts`, dagre) of the graph
// of 500 nodes that "Whole chain" over every kind gives for the first need, the median of 5 runs. It is
// recorded, not asserted: SR-111 AK6 is asserted end to end in the app (test/graph-performance.spec.ts),
// and `packages/core/test/perf/trace-graph.test.ts` records the core part of the same call.
import type { TraceGraphOutput } from "@logreq/core";
import { Workspace, invoke, warmWorkspace } from "@logreq/core";
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@logreq/testkit";
import { generateLargeWorkspace, measureMedian, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { layoutGraph } from "../../src/renderer/graph-layout.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-111 AK6. */
const NODES = 500;

describe("the layout of a graph of 500 nodes (SR-111 AK6, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    // One old version for every link: the layout does not look at versions (every node is marked
    // outdated, which changes only a class), and the app's tests do not reach core's version function.
    tree = generateLargeWorkspace({
      version: () => "n1:0000000000000000",
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    await warmWorkspace(workspace);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it("records the layout of the whole chain of the first need over every kind", async () => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    const need = tree.elements.find((element) => element.type === "need")?.id ?? "";
    const output = (await invoke(
      "trace.graph",
      { ref: need, allLevels: true, limit: NODES },
      { workspace },
    )) as TraceGraphOutput;
    expect(output.nodes).toHaveLength(NODES);
    const { result } = await measureMedian(
      `graph: app layout of a graph of 500 nodes, ${String(output.edges.length)} links (whole chain of the first need, every kind), median of 5`,
      () => layoutGraph(output),
      { basis: "SR-111 AK6 (recorded; asserted end to end in the app)", runs: 5 },
    );
    expect(result.nodes).toHaveLength(NODES);
  });
});
