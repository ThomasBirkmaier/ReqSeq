// The layout part of SR-111 AK6 in the performance suite (ADR-0011), on the generated workspace of N-036
// with 50,000 elements and 200,000 relations: the app's layout (`graph-layout.ts`, dagre) of the graph
// of 500 nodes that "Whole chain" over every kind gives for the first need (its layers are the levels,
// #500), its first run in this process and the median of 5 runs; and of the 200 nearest nodes of the
// same chain, the largest graph whose links within a level are ranked. It is recorded, not asserted:
// SR-111 AK6 is asserted end to end in the app (test/graph-performance.spec.ts), and
// `packages/core/test/perf/trace-graph.test.ts` records the core part of the same call.
import type { TraceGraphOutput } from "@reqseq/core";
import { Workspace, invoke, warmWorkspace } from "@reqseq/core";
import type { GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import { generateLargeWorkspace, measureMedian, recordValue, writeLargeWorkspace } from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEVEL_LAYERS_ABOVE, layoutGraph } from "../../src/renderer/graph-layout.js";

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

  /** The whole chain of the first need over every kind, at most `limit` nodes. */
  const wholeChain = async (limit: number): Promise<TraceGraphOutput> => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    const need = tree.elements.find((element) => element.type === "need")?.id ?? "";
    return (await invoke(
      "trace.graph",
      { ref: need, allLevels: true, limit },
      { workspace },
    )) as TraceGraphOutput;
  };

  it("records the layout of the whole chain of the first need over every kind", async () => {
    const output = await wholeChain(NODES);
    expect(output.nodes).toHaveLength(NODES);
    const name = `graph: app layout of a graph of 500 nodes, ${String(output.edges.length)} links (whole chain of the first need, every kind)`;
    const basis = "SR-111 AK6 (recorded; asserted end to end in the app)";
    const { result, times } = await measureMedian(`${name}, median of 5`, () => layoutGraph(output), {
      basis,
      runs: 5,
    });
    // The first layout of the process: dagre's code is cold, as in the app's first graph.
    await recordValue(`${name}, first run`, times[0] ?? Number.NaN, { basis });
    expect(result.nodes).toHaveLength(NODES);
  });

  it("records the layout of the 200 nearest nodes of the same chain, the largest graph whose links within a level are ranked", async () => {
    const output = await wholeChain(LEVEL_LAYERS_ABOVE);
    expect(output.nodes).toHaveLength(LEVEL_LAYERS_ABOVE);
    const { result } = await measureMedian(
      `graph: app layout of the ${String(LEVEL_LAYERS_ABOVE)} nearest nodes, ${String(output.edges.length)} links (whole chain of the first need, every kind, ranked), median of 5`,
      () => layoutGraph(output),
      { basis: "SR-111 AK6 (recorded; #500)", runs: 5 },
    );
    expect(result.nodes).toHaveLength(LEVEL_LAYERS_ABOVE);
  });
});
