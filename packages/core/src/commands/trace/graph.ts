// trace.graph (SR-111, D-063): the graph of one element, its nodes, edges, marks and verification
// (`graph/element.ts`), and the evidence below the nodes.
//
// Evidence (SR-111 AK3, plan on #217): with `withEvidence`, one summary per node at level 0 or below
// whose evidence level (its level + 1) is within the depth asked, `expanded` or not, and only when it
// has any: how many test cases and records, and the newest result of each. It comes from
// `chainEvidenceOf` on the same index in the view (the core without one), so it is what trace.chain
// lists below the element in that view. The summaries are no nodes: `limit` counts the elements only (assumption on #217). An evidence location that is not on this
// machine makes the graph `incomplete`.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { ElementEvidence } from "../../evidence/index.js";
import { chainEvidenceOf, evidenceIndexState } from "../../evidence/index.js";
import { elementGraphOf } from "../../graph/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import type { ElementGraph, TraceContext } from "../../trace/index.js";
import type { View } from "../../variants/index.js";
import { variantIndependentOf } from "../../workspace/index.js";

const CORE: View = { kind: "core" };

type Summary = NonNullable<CommandOutput<"trace.graph">["evidence"]>[number];

/** The results a summary counts, in the order it lists them. */
const RESULTS = ["passed", "failed", "inconclusive", "skipped"] as const;

/** The counts of `evidence`: the newest result of each test case (`skipped` when only skipped) and record. */
const countsOf = (evidence: ElementEvidence): Pick<Summary, "testCases" | "records" | "results"> => {
  const counts = new Map<string, number>();
  const count = (result: string): void => {
    counts.set(result, (counts.get(result) ?? 0) + 1);
  };
  for (const test of evidence.testCases) {
    count(test.last?.result ?? "skipped");
  }
  for (const record of evidence.records) {
    count(record.result);
  }
  const results: Record<string, number> = {};
  for (const result of RESULTS) {
    const n = counts.get(result);
    if (n !== undefined) {
      results[result] = n;
    }
  }
  return { testCases: evidence.testCases.length, records: evidence.records.length, results };
};

/**
 * The summaries of the evidence below the nodes of `graph` (see the file comment): nodes at level 0 or
 * below whose evidence level is at most `maxDepth` (every one when undefined), in node order.
 */
const evidenceOf = async (
  workspace: Workspace,
  base: TraceContext,
  graph: ElementGraph,
  view: View | undefined,
  maxDepth: number | undefined,
): Promise<Summary[]> => {
  const index = await workspace.get(evidenceIndexState);
  const marked = variantIndependentOf(base.layout);
  const summaries: Summary[] = [];
  for (const { element, level } of graph.nodes) {
    if (level < 0 || (maxDepth !== undefined && level + 1 > maxDepth)) {
      continue;
    }
    const evidence = chainEvidenceOf(index, element.id, view ?? CORE, marked.has(element.repository));
    if (evidence !== undefined) {
      summaries.push({
        id: element.id,
        repository: element.repository,
        level: level + 1,
        ...countsOf(evidence),
      });
    }
  }
  return summaries;
};

export default defineCommand({
  name: "trace.graph",
  run: async (ctx, input): Promise<CommandOutput<"trace.graph">> => {
    const { withEvidence, ...asked } = input;
    const { output, base, graph, view, maxDepth } = await elementGraphOf(ctx.workspace, asked, "trace.graph");
    const { problems, ...rest } = output;
    return {
      ...rest,
      ...(withEvidence ? { evidence: await evidenceOf(ctx.workspace, base, graph, view, maxDepth) } : {}),
      problems,
    };
  },
});
