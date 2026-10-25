// trace.affected (SR-006, SR-024): the elements affected by a change of one element, directly or
// through the chain, each with its way and distance, one page of `limit` from `offset` with the
// `total`, and `incomplete` (trace/affected.ts). The chain
// follows the relation kinds with the meaning `derivation` (SR-013 AK1, AK3). Evidence records of
// an older version (AK4) come in stage 4 (SR-028): until then the list is empty.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { resolveRef, shortIdState } from "../../model/index.js";
import { affectedOutput, derivationGraph, traceAffected, traceContext } from "../../trace/index.js";

export default defineCommand({
  name: "trace.affected",
  run: async (ctx, input): Promise<CommandOutput<"trace.affected">> => {
    const graph = derivationGraph(await traceContext(ctx.workspace), "trace.affected");
    const shortIds = await ctx.workspace.get(shortIdState);
    const element = resolveRef(graph.store, shortIds, input.ref);
    return affectedOutput(
      traceAffected(graph, element),
      { metamodel: graph.metamodel, shortIds },
      { limit: input.limit, offset: input.offset },
    );
  },
});
