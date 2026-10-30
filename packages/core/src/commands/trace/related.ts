// trace.related (SR-023): every element derived from a selection of parents (`children`, AK1), or
// every parent a selection of requirements derives from (`parents`, AK3), each once (AK2), up to
// `maxDepth` steps (trace/related.ts). The relation kinds come from the meaning `derivation`
// (SR-013 AK1, AK3). `view` keeps the elements the view of the core or a variant holds (`viewRuleOf`,
// SR-040, SR-041, SR-043). The walk is always complete and `total`
// counts every related element; only the page of `limit` elements from `offset` is built, as list
// commands give elements, without text (model/list.ts). `incomplete` per SR-006 AK2, also for a variant's view while a repository is not here
// (`viewIncomplete`).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { listElements, resolveRef, shortIdState } from "../../model/index.js";
import { derivationGraph, relatedElements, traceContext } from "../../trace/index.js";
import { resolveView, viewIncomplete, viewRuleOf } from "../../variants/index.js";

export default defineCommand({
  name: "trace.related",
  run: async (ctx, input): Promise<CommandOutput<"trace.related">> => {
    const graph = derivationGraph(await traceContext(ctx.workspace), "trace.related");
    const { layout, metamodel, store } = graph;
    const shortIds = await ctx.workspace.get(shortIdState);
    const selection = input.refs.map((ref) => resolveRef(store, shortIds, ref));
    const view =
      input.view === undefined
        ? undefined
        : resolveView({ metamodel, store, shortIds }, input.view, "trace.related");
    const related = relatedElements(graph, selection, {
      direction: input.direction,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
      ...(view === undefined
        ? {}
        : { includes: viewRuleOf({ workspace: ctx.workspace, store, metamodel }, view).includes }),
    });
    const page = related.elements.slice(input.offset, input.offset + input.limit);
    const elements = await listElements(ctx.workspace, { layout, metamodel, store, shortIds }, page);
    return {
      elements,
      total: related.elements.length,
      incomplete: related.incomplete || viewIncomplete(layout, view),
    };
  },
});
