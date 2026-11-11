// trace.graph (SR-111, D-063): the graph of one element over every relation kind, relation property
// and inline reference (or the chosen ones), up and down to a depth, each element one node with its
// level and marks, each link between two nodes one edge (trace/element-graph.ts). Without `maxDepth`
// the direct neighbours; the whole chain comes with `allLevels`; at most `limit` nodes, the nearest
// first. `view` keeps the elements the view of the core or a variant holds (`viewRuleOf`,
// SR-040, SR-041, SR-043); a variant's view is `incomplete` while a repository is not here.
//
// The marks (SR-111 AK4; assumptions of spec question ThomasBirkmaier/ReqSeq-archive#478) are the rules of the hints,
// so the graph says what element.get says:
// - `outdated`: the element stores an outdated relation, relation property or inline reference, the
//   `relation.outdated` and `variant.core-changed` hints of element.get (`outdatedAmong`), whatever
//   kinds are followed, and also for a source with an invalid status, which has no such hints
//   (SR-025 AK5: in the chain the relation stays visible);
// - `superseded`: its status is one the metamodel marks invalid (D-044, `invalidStatuses`), the rule
//   of `relation.target-superseded`;
//
// Verification (SR-136, `graphVerification`): each requirement node its status in the graph's view (the
// core without one) and the count of its progress ring, each need node the verification degree of its
// derivation children in the whole workspace, from the shared status, as element.get and evidence.degree
// give them. An evidence location that is not on this machine makes the graph `incomplete`, as the
// chain. Without the meanings `derivation` and `requirement` a hint says the status and degree are not
// complete.
//
// Evidence (SR-111 AK3, plan on #217): with `withEvidence`, one summary per node at level 0 or below
// whose evidence level (its level + 1) is within the depth asked, `expanded` or not, and only when it
// has any: how many test cases and records, and the newest result of each. It comes from
// `chainEvidenceOf` on the same index in the view (the core without one), so it is what trace.chain
// lists below the element in that view. The summaries are no nodes: `limit` counts the elements only (assumption on #217). An evidence location that is not on this
// machine makes the graph `incomplete`.
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { ElementEvidence } from "../../evidence/index.js";
import {
  chainEvidenceOf,
  evidenceIndexState,
  evidenceReadState,
  graphVerification,
} from "../../evidence/index.js";
import { outdatedAmong } from "../../hints/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { meaningUnassignedMessage } from "../../metamodel/index.js";
import type { ElementStore } from "../../model/index.js";
import { invalidStatuses, resolveRef, shortIdState } from "../../model/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import type { ElementGraph, GraphMark, MarksOf, TraceContext } from "../../trace/index.js";
import {
  checkRelationKinds,
  currentVersionLookup,
  elementGraph,
  elementGraphOutput,
  neighbourhoodContext,
  traceContext,
} from "../../trace/index.js";
import type { View } from "../../variants/index.js";
import { resolveView, viewIncomplete, viewRuleOf } from "../../variants/index.js";
import { variantIndependentOf, workspaceLayoutState } from "../../workspace/index.js";

/** The meanings the verification status and degree need in full. */
const GAP_MEANINGS = ["derivation", "requirement"] as const;

const CORE: View = { kind: "core" };

/** The meanings of `GAP_MEANINGS` that no key of `metamodel` has. */
const unassignedOf = (metamodel: Metamodel): readonly (typeof GAP_MEANINGS)[number][] =>
  GAP_MEANINGS.filter((meaning) => metamodel.meanings[meaning].length === 0);

/** The marks of the nodes (see the file comment). */
const marksOf = async (workspace: Workspace, metamodel: Metamodel, store: ElementStore): Promise<MarksOf> => {
  const layout = await workspace.get(workspaceLayoutState);
  const invalid = invalidStatuses(metamodel);
  return async (elements) => {
    const outdated = await outdatedAmong({ workspace, layout, metamodel, store }, elements);
    return (element) => {
      const marks: GraphMark[] = [];
      if (outdated.has(element)) {
        marks.push("outdated");
      }
      if (invalid.has(String(element.data["status"]))) {
        marks.push("superseded");
      }
      return marks;
    };
  };
};

/**
 * Whether the records the status or the evidence read are incomplete: an evidence location is not on
 * this machine (SR-006 AK2, as trace.chain says).
 */
const evidenceIncomplete = async (workspace: Workspace): Promise<boolean> =>
  (await workspace.get(evidenceReadState)).incomplete;

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

/** The hints: the meanings the status and degree need that no key has (SR-013 AK3), while the metamodel is valid. */
const problemsOf = (metamodel: Metamodel): Problem[] =>
  metamodel.valid
    ? unassignedOf(metamodel).map((meaning) => ({
        code: "metamodel.meaning-unassigned",
        severity: "warning",
        message: meaningUnassignedMessage(meaning, "trace.graph"),
      }))
    : [];

export default defineCommand({
  name: "trace.graph",
  run: async (ctx, input): Promise<CommandOutput<"trace.graph">> => {
    const base = await traceContext(ctx.workspace);
    const { metamodel, store } = base;
    if (input.allLevels && input.maxDepth !== undefined) {
      throw new CommandError("input.invalid", "give maxDepth or allLevels, not both", {
        command: "trace.graph",
        fields: ["maxDepth", "allLevels"],
      });
    }
    checkRelationKinds(metamodel, input.kinds, "trace.graph");
    const shortIds = await ctx.workspace.get(shortIdState);
    const root = resolveRef(
      store,
      shortIds,
      input.ref,
      input.repository === undefined ? {} : { repository: input.repository },
    );
    const view =
      input.view === undefined
        ? undefined
        : resolveView({ metamodel, store, shortIds }, input.view, "trace.graph");
    const includes =
      view === undefined
        ? undefined
        : viewRuleOf({ workspace: ctx.workspace, store, metamodel }, view).includes;
    const context = neighbourhoodContext(base, {
      ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
      ...(input.meanings === undefined ? {} : { meanings: input.meanings }),
    });
    const maxDepth = input.allLevels ? undefined : (input.maxDepth ?? 1);
    const graph = elementGraph(context, root, {
      ...(maxDepth === undefined ? {} : { maxDepth }),
      ...(includes === undefined ? {} : { includes }),
      limit: input.limit,
    });
    const output = await elementGraphOutput(
      graph,
      { ...context, shortIds },
      currentVersionLookup(ctx.workspace),
      await marksOf(ctx.workspace, metamodel, store),
      await graphVerification(
        ctx.workspace,
        graph.nodes.map((place) => place.element),
        view,
      ),
    );
    return {
      ...output,
      ...(input.withEvidence
        ? { evidence: await evidenceOf(ctx.workspace, base, graph, view, maxDepth) }
        : {}),
      ...(viewIncomplete(base.layout, view) || (await evidenceIncomplete(ctx.workspace))
        ? { incomplete: true }
        : {}),
      problems: problemsOf(metamodel),
    };
  },
});
