// trace.graph (SR-111, D-063): the graph of one element over every relation kind, relation property
// and inline reference (or the chosen ones), up and down to a depth, each element one node with its
// level and marks, each link between two nodes one edge (trace/element-graph.ts). Without `maxDepth`
// the direct neighbours; the whole chain comes with `allLevels`; at most `limit` nodes, the nearest
// first. `view` keeps the elements the view of the core or a variant holds (`viewRuleOf`,
// SR-040, SR-041, SR-043); a variant's view is `incomplete` while a repository is not here.
//
// The marks (SR-111 AK4; assumptions of spec question #478) are the rules of the hints and the chain,
// so the graph says what element.get and trace.chain say:
// - `outdated`: the element stores an outdated relation, relation property or inline reference, the
//   `relation.outdated` and `variant.core-changed` hints of element.get (`outdatedAmong`), whatever
//   kinds are followed;
// - `superseded`: its status is one the metamodel marks invalid (D-044, `invalidStatuses`), the rule
//   of `relation.target-superseded`;
// - `no-evidence`: the gap rule of trace.chain (`lacksEvidence`, SR-022 AK3), in the same view.
//   Without the meanings `derivation` and `requirement` there is none, and a hint says so.
import type { CommandOutput, Problem } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { outdatedAmong } from "../../hints/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { meaningUnassignedMessage } from "../../metamodel/index.js";
import type { ElementRecord } from "../../model/index.js";
import { invalidStatuses, resolveRef, shortIdState } from "../../model/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import type { GraphMark, MarksOf, TraceContext } from "../../trace/index.js";
import {
  checkRelationKinds,
  currentVersionLookup,
  derivationGraph,
  elementGraph,
  elementGraphOutput,
  lacksEvidence,
  neighbourhoodContext,
  traceContext,
} from "../../trace/index.js";
import { resolveView, viewIncomplete, viewRuleOf } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** The meanings the `no-evidence` mark needs. */
const GAP_MEANINGS = ["derivation", "requirement"] as const;

const NO_EVIDENCE: readonly never[] = Object.freeze([]);

/** The meanings of `GAP_MEANINGS` that no key of `metamodel` has. */
const unassignedOf = (metamodel: Metamodel): readonly (typeof GAP_MEANINGS)[number][] =>
  GAP_MEANINGS.filter((meaning) => metamodel.meanings[meaning].length === 0);

/** The marks of the nodes (see the file comment). */
const marksOf = async (
  workspace: Workspace,
  base: TraceContext,
  includes: ((element: ElementRecord) => boolean) | undefined,
): Promise<MarksOf> => {
  const { metamodel, store } = base;
  const layout = await workspace.get(workspaceLayoutState);
  const invalid = invalidStatuses(metamodel);
  // Stage 4 passes each element's evidence records here (SR-028); until then there are none.
  const gap =
    unassignedOf(metamodel).length === 0
      ? lacksEvidence(derivationGraph(base, "trace.graph"), includes)
      : undefined;
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
      if (gap?.(element, NO_EVIDENCE) === true) {
        marks.push("no-evidence");
      }
      return marks;
    };
  };
};

/** The hints: the meanings `no-evidence` needs that no key has (SR-013 AK3), while the metamodel is valid. */
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
    const graph = elementGraph(context, root, {
      ...(input.allLevels ? {} : { maxDepth: input.maxDepth ?? 1 }),
      ...(includes === undefined ? {} : { includes }),
      limit: input.limit,
    });
    const output = await elementGraphOutput(
      graph,
      { ...context, shortIds },
      currentVersionLookup(ctx.workspace),
      await marksOf(ctx.workspace, base, includes),
    );
    return {
      ...output,
      ...(viewIncomplete(base.layout, view) ? { incomplete: true } : {}),
      problems: problemsOf(metamodel),
    };
  },
});
