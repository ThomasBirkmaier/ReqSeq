// trace.affected (SR-006, SR-024): the elements affected by a change of one element, directly or
// through the chain, each with its way and distance, one page of `limit` from `offset` with the
// `total`, and `incomplete` (trace/affected.ts). The chain
// follows the relation kinds with the meaning `derivation` (SR-013 AK1, AK3). Evidence records of
// an older version (AK4): the element's records of the evidence index whose version is not its
// current one (`currentVersionsOf`, computed only when the element has records). When its current
// version cannot be computed (its file no longer holds it, an image cannot be read), no record is
// known to be of an older version and the list is empty.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { evidenceIndexState } from "../../evidence/index.js";
import { currentVersionsOf, resolveRef, shortIdState } from "../../model/index.js";
import type { AffectedOptions } from "../../trace/index.js";
import { affectedOutput, derivationGraph, traceAffected, traceContext } from "../../trace/index.js";

export default defineCommand({
  name: "trace.affected",
  run: async (ctx, input): Promise<CommandOutput<"trace.affected">> => {
    const graph = derivationGraph(await traceContext(ctx.workspace), "trace.affected");
    const shortIds = await ctx.workspace.get(shortIdState);
    const element = resolveRef(graph.store, shortIds, input.ref);
    const records = (await ctx.workspace.get(evidenceIndexState)).byElement.get(element.id) ?? [];
    let options: AffectedOptions = {};
    if (records.length > 0) {
      const current = (await currentVersionsOf(ctx.workspace, [element])).get(element);
      if (current?.kind === "version") {
        options = { evidence: { version: current.version, records } };
      }
    }
    return affectedOutput(
      traceAffected(graph, element, options),
      { metamodel: graph.metamodel, shortIds },
      { limit: input.limit, offset: input.offset },
    );
  },
});
