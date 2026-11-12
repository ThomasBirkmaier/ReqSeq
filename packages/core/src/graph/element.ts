// The graph of one element (SR-111, D-063) as trace.graph gives it, so that a command for the Mermaid
// text (SR-151 AK1, #1537) can ask for the same graph under its own name: the graph over every relation kind, relation property
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
// The evidence below the nodes (SR-111 AK3) is trace.graph's own: `withEvidence` is no input here.
import type { CommandInput, CommandName, CommandOutput, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { evidenceReadState, graphVerification } from "../evidence/index.js";
import { outdatedAmong } from "../hints/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { meaningUnassignedMessage } from "../metamodel/index.js";
import type { ElementStore } from "../model/index.js";
import { invalidStatuses, resolveRef, shortIdState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { ElementGraph, GraphMark, MarksOf, TraceContext } from "../trace/index.js";
import {
  checkRelationKinds,
  currentVersionLookup,
  elementGraph,
  elementGraphOutput,
  neighbourhoodContext,
  traceContext,
} from "../trace/index.js";
import type { View } from "../variants/index.js";
import { resolveView, viewIncomplete, viewRuleOf } from "../variants/index.js";
import { workspaceLayoutState } from "../workspace/index.js";

/** The meanings the verification status and degree need in full. */
const GAP_MEANINGS = ["derivation", "requirement"] as const;

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

/** The hints: the meanings the status and degree need that no key has (SR-013 AK3), while the metamodel is valid. */
const problemsOf = (metamodel: Metamodel, command: CommandName): Problem[] =>
  metamodel.valid
    ? unassignedOf(metamodel).map((meaning) => ({
        code: "metamodel.meaning-unassigned",
        severity: "warning",
        message: meaningUnassignedMessage(meaning, command),
      }))
    : [];

/** The graph of an element, without the evidence below it. */
export type ElementGraphInput = Omit<CommandInput<"trace.graph">, "withEvidence">;

/** The output of `elementGraphOf`, and what the evidence below the nodes is read from. */
export interface ElementGraphResult {
  readonly output: Omit<CommandOutput<"trace.graph">, "evidence">;
  readonly base: TraceContext;
  readonly graph: ElementGraph;
  readonly view: View | undefined;
  /** The depth asked; undefined for the whole chain. */
  readonly maxDepth: number | undefined;
}

/**
 * The output of trace.graph for `input` without the evidence (see the file comment); problems and errors
 * name `command`, the command that asks.
 */
export const elementGraphOf = async (
  workspace: Workspace,
  input: ElementGraphInput,
  command: CommandName,
): Promise<ElementGraphResult> => {
  const base = await traceContext(workspace);
  const { metamodel, store } = base;
  if (input.allLevels && input.maxDepth !== undefined) {
    throw new CommandError("input.invalid", "give maxDepth or allLevels, not both", {
      command,
      fields: ["maxDepth", "allLevels"],
    });
  }
  checkRelationKinds(metamodel, input.kinds, command);
  const shortIds = await workspace.get(shortIdState);
  const root = resolveRef(
    store,
    shortIds,
    input.ref,
    input.repository === undefined ? {} : { repository: input.repository },
  );
  const view =
    input.view === undefined ? undefined : resolveView({ metamodel, store, shortIds }, input.view, command);
  const includes =
    view === undefined ? undefined : viewRuleOf({ workspace, store, metamodel }, view).includes;
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
    currentVersionLookup(workspace),
    await marksOf(workspace, metamodel, store),
    await graphVerification(
      workspace,
      graph.nodes.map((place) => place.element),
      view,
    ),
  );
  return {
    output: {
      ...output,
      ...(viewIncomplete(base.layout, view) || (await evidenceIncomplete(workspace))
        ? { incomplete: true }
        : {}),
      problems: problemsOf(metamodel, command),
    },
    base,
    graph,
    view,
    maxDepth,
  };
};
