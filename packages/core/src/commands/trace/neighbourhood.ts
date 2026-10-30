// trace.neighbourhood (SR-107, D-031, D-062): the surroundings of one element over every relation
// kind, relation property and inline reference, up and down to a depth, with `repeated` and
// `outdated` per edge (trace/neighbourhood.ts). Without `maxDepth` the direct neighbours; the whole
// chain comes with `allLevels`. `kinds` and `meanings` narrow what is followed; `view` keeps the
// elements the view of the core or a variant holds (`viewRuleOf`, SR-040, SR-041, SR-043), and a
// variant's view is `incomplete` while a repository is not here (`viewIncomplete`). The walk is
// always complete; the output is one page of `limit` nodes from `offset` with `total` (SR-082 AK4).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { resolveRef, shortIdState } from "../../model/index.js";
import {
  checkRelationKinds,
  currentVersionLookup,
  neighbourhoodContext,
  neighbourhoodOutput,
  traceContext,
  traceNeighbourhood,
} from "../../trace/index.js";
import { resolveView, viewIncomplete, viewRuleOf } from "../../variants/index.js";

export default defineCommand({
  name: "trace.neighbourhood",
  run: async (ctx, input): Promise<CommandOutput<"trace.neighbourhood">> => {
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
    const neighbourhood = traceNeighbourhood(
      neighbourhoodContext(base, {
        ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
        ...(input.meanings === undefined ? {} : { meanings: input.meanings }),
      }),
      root,
      {
        direction: input.direction,
        ...(input.allLevels ? {} : { maxDepth: input.maxDepth ?? 1 }),
        ...(view === undefined
          ? {}
          : { includes: viewRuleOf({ workspace: ctx.workspace, store, metamodel }, view).includes }),
      },
    );
    const output = await neighbourhoodOutput(
      neighbourhood,
      { metamodel, shortIds },
      { limit: input.limit, offset: input.offset },
      currentVersionLookup(ctx.workspace),
    );
    return viewIncomplete(base.layout, view) ? { ...output, incomplete: true } : output;
  },
});
