// trace.chain (SR-006, SR-022, SR-033): the chain of one element up to the top parents and down to
// the evidence, with depth, gaps, cycles and `incomplete` (trace/chain.ts). The relation kinds come
// from the meaning `derivation` (SR-013 AK1, AK3); `view` keeps the elements that apply in the core
// or a variant by their validity (`appliesIn`, SR-040; the full views come in stage 5). Evidence
// records come in stage 4 (SR-028, SR-033): until then the chain has none.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { resolveRef, shortIdState } from "../../model/index.js";
import { chainOutput, derivationGraph, traceChain, traceContext } from "../../trace/index.js";
import { appliesIn, resolveView, validityOf } from "../../variants/index.js";

export default defineCommand({
  name: "trace.chain",
  run: async (ctx, input): Promise<CommandOutput<"trace.chain">> => {
    const graph = derivationGraph(await traceContext(ctx.workspace), "trace.chain");
    const { metamodel, store } = graph;
    const shortIds = await ctx.workspace.get(shortIdState);
    const root = resolveRef(store, shortIds, input.ref);
    const view =
      input.view === undefined
        ? undefined
        : resolveView({ metamodel, store, shortIds }, input.view, "trace.chain");
    const validity = validityOf(metamodel);
    const chain = traceChain(graph, root, {
      direction: input.direction,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
      ...(view === undefined ? {} : { includes: (element) => appliesIn(validity, element, view) }),
    });
    return chainOutput(chain, { metamodel, shortIds });
  },
});
