// trace.chain (SR-006, SR-022, SR-033): the chain of one element up to the top parents and down to
// the evidence, with depth, gaps, cycles and `incomplete` (trace/chain.ts). The relation kinds come
// from the meaning `derivation` (SR-013 AK1, AK3); `view` keeps the elements that apply in the core
// or a variant by their validity (`appliesIn`, SR-040; the full views come in stage 5). The walk is
// always complete; the output is one page of `limit` nodes from `offset` with `total` (SR-082 AK4,
// spec-frage #290), as `trace.related` and `trace.affected` give theirs.
//
// Evidence (SR-022 AK1, AK3; SR-033), only when the chain goes down: the evidence index decides the
// `no-evidence` gap of every element (`hasVerificationRecord` in the view, the core without one; any
// version and result, spec questions #527 Q3 and Q4), and gives the test cases and records below
// each expanded downward node of the page (`chainEvidenceOf`: verification records that hold in the
// view, every one without a view; assumptions A2 and A5 of #528 Q4). An evidence location that is
// not on this machine makes the chain `incomplete` (SR-006 AK2). The upward chain reads no records.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  chainEvidenceOf,
  evidenceIndexState,
  evidenceReadState,
  hasVerificationRecord,
} from "../../evidence/index.js";
import { resolveRef, shortIdState } from "../../model/index.js";
import { chainOutput, derivationGraph, traceChain, traceContext } from "../../trace/index.js";
import type { View } from "../../variants/index.js";
import { appliesIn, resolveView, validityOf } from "../../variants/index.js";

const CORE: View = { kind: "core" };

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
    const down = input.direction !== "up";
    const index = down ? await ctx.workspace.get(evidenceIndexState) : undefined;
    const read = down ? await ctx.workspace.get(evidenceReadState) : undefined;
    const gapView = view ?? CORE;
    const chain = traceChain(graph, root, {
      direction: input.direction,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
      ...(view === undefined ? {} : { includes: (element) => appliesIn(validity, element, view) }),
      ...(index === undefined
        ? {}
        : { hasEvidence: (element) => hasVerificationRecord(index, element.id, gapView) }),
    });
    const output = chainOutput(
      chain,
      {
        metamodel,
        shortIds,
        ...(index === undefined ? {} : { evidenceOf: (element) => chainEvidenceOf(index, element.id, view) }),
      },
      { limit: input.limit, offset: input.offset },
    );
    return read?.incomplete === true ? { ...output, incomplete: true } : output;
  },
});
