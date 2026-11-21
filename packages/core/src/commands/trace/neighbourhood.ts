// trace.neighbourhood (SR-107, D-031, D-062): the elements reached from one element over every
// relation kind, relation property and inline reference, up and down to a depth, with `repeated` and
// `outdated` per edge (trace/neighbourhood.ts). Without `maxDepth` the direct neighbours; the whole
// chain comes with `allLevels`. `kinds` and `meanings` narrow what is followed; `view` keeps the
// elements the view of the core or a variant holds (`viewRuleOf`, SR-040, SR-041, SR-043), and a
// variant's view is `incomplete` while a repository is not here (`viewIncomplete`). The walk is
// always complete; the output is one page of `limit` nodes from `offset` with `total` (SR-082 AK4).
// With the root's incoming links looked at, `incoming` groups them by key (SR-107 AK5, AK6): a count
// per key and its first 100 elements by identifier, then short ID (`sortElements`, SR-075 AK1).
// `countedElements` (SR-224 AK4): every element of the group whose `link` and `kind` the key names,
// without the walks' output; no element where the output has no `incoming`.
import type { CommandContext, CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand, matchesKey } from "../../catalog.js";
import type { ElementRecord } from "../../model/index.js";
import { namesField, namesOf, resolveRef, shortIdState } from "../../model/index.js";
import {
  checkRelationKinds,
  currentVersionLookup,
  incomingGroups,
  incomingOutput,
  neighbourhoodContext,
  neighbourhoodOutput,
  traceContext,
  traceNeighbourhood,
} from "../../trace/index.js";
import type { IncomingGroup } from "../../trace/index.js";
import { sortElements } from "../../query/index.js";
import { resolveView, viewIncomplete, viewRuleOf } from "../../variants/index.js";
import { counted, incompleteNote, rootNamed, sentence } from "../answer.js";

/** The order of the elements of an incoming group: identifier, then short ID (SR-107 AK5, SR-075 AK1). */
const BY_IDENTIFIER = [
  { by: "identifier", order: "asc" },
  { by: "id", order: "asc" },
] as const;

/** What the run and the counted elements share: the root, the followed links, the view and the groups. */
const prepared = async (ctx: CommandContext, input: CommandInput<"trace.neighbourhood">) => {
  const base = await traceContext(ctx.workspace);
  const { metamodel, store } = base;
  if (input.allLevels && input.maxDepth !== undefined) {
    throw new CommandError("input.invalid", "give maxDepth or allLevels, not both", {
      command: "trace.neighbourhood",
      fields: ["maxDepth", "allLevels"],
    });
  }
  checkRelationKinds(metamodel, input.kinds, "trace.neighbourhood");
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
      : resolveView({ metamodel, store, shortIds }, input.view, "trace.neighbourhood");
  const includes =
    view === undefined
      ? undefined
      : viewRuleOf({ workspace: ctx.workspace, store, metamodel }, view).includes;
  const context = neighbourhoodContext(base, {
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    ...(input.meanings === undefined ? {} : { meanings: input.meanings }),
  });
  const maxDepth = input.allLevels ? undefined : (input.maxDepth ?? 1);
  // The root's incoming links are looked at: the output has `incoming`.
  const grouped = input.direction !== "up" && maxDepth !== 0;
  const groups: readonly IncomingGroup[] = grouped ? incomingGroups(context, root, includes) : [];
  return { base, shortIds, root, view, includes, context, maxDepth, grouped, groups };
};

export default defineCommand({
  name: "trace.neighbourhood",
  answer: (output, input) =>
    sentence(
      `The neighbourhood of ${rootNamed(output.root, [...output.nodes, ...(output.names ?? [])], input.ref)} has ${counted(output.total, "element")}`,
      incompleteNote(output.incomplete),
    ),
  run: async (ctx, input): Promise<CommandOutput<"trace.neighbourhood">> => {
    const { base, shortIds, root, view, includes, context, maxDepth, grouped, groups } = await prepared(
      ctx,
      input,
    );
    const { metamodel, store } = base;
    const neighbourhood = traceNeighbourhood(context, root, {
      direction: input.direction,
      ...(maxDepth === undefined ? {} : { maxDepth }),
      ...(includes === undefined ? {} : { includes }),
    });
    const output = await neighbourhoodOutput(
      neighbourhood,
      { metamodel, shortIds },
      { limit: input.limit, offset: input.offset },
      currentVersionLookup(ctx.workspace),
    );
    const order = (elements: readonly ElementRecord[]): readonly ElementRecord[] =>
      sortElements({ command: "trace.neighbourhood", metamodel, store, shortIds }, elements, BY_IDENTIFIER)
        .elements;
    // The root by name on every page, also one that does not hold it (the answer names it, #1874).
    const named = {
      ...output,
      ...(grouped ? { incoming: incomingOutput(groups, { metamodel, shortIds }, order) } : {}),
      ...namesField(namesOf({ metamodel, store, shortIds }, [root.id])),
    };
    return viewIncomplete(base.layout, view) ? { ...named, incomplete: true } : named;
  },
  countedElements: async (ctx, input, count) => {
    const { base, view, context, groups } = await prepared(ctx, input);
    const [key = {}] = count.key;
    const group = groups.find((g) =>
      matchesKey(g.key === undefined ? { link: "reference" } : { link: "relation", kind: g.key }, key, [
        "link",
        "kind",
      ]),
    );
    return {
      elements: (group?.sources ?? []).map(({ id, repository, file }) => ({ id, repository, file })),
      incomplete: context.unavailable || viewIncomplete(base.layout, view),
    };
  },
});
