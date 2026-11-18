// trace.affected (SR-006, SR-024): the elements affected by a change of one element, directly or
// through the chain, each with its way and distance, one page of `limit` from `offset` with the
// `total`, and `incomplete` (trace/affected.ts). The chain
// follows the relation kinds with the meaning `derivation` (SR-013 AK1, AK3). Evidence records of
// an older version (AK4): the element's records of the evidence index whose version is not its
// current one (`currentVersionsOf`, computed only when the element has records). When its current
// version cannot be computed (its file no longer holds it, an image cannot be read), no record is
// known to be of an older version and the list is empty. Each record names its criteria with number,
// key and text, counted in the current version (`recordNamer`, SR-205 AK2). `outputElements` gives every
// affected element without building an entry (`selection.output`, SR-224 AK5).
import type { CommandContext, CommandInput, CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { evidenceIndexState, recordNamer, withEvidenceSource } from "../../evidence/index.js";
import type { ElementRecord, ShortIds } from "../../model/index.js";
import { currentVersionsOf, resolveRef, shortIdState } from "../../model/index.js";
import type { AffectedOptions, DerivationGraph } from "../../trace/index.js";
import { affectedOutput, derivationGraph, traceAffected, traceContext } from "../../trace/index.js";

/** The derivation graph, the short IDs and the element of `input`. */
const startOf = async (
  ctx: CommandContext,
  input: CommandInput<"trace.affected">,
): Promise<{
  readonly graph: DerivationGraph;
  readonly shortIds: ShortIds;
  readonly element: ElementRecord;
}> => {
  const graph = derivationGraph(await traceContext(ctx.workspace), "trace.affected");
  const shortIds = await ctx.workspace.get(shortIdState);
  const element = resolveRef(graph.store, shortIds, input.ref, {
    repository: input.repository,
    file: input.file,
  });
  return { graph, shortIds, element };
};

export default defineCommand({
  name: "trace.affected",
  run: async (ctx, input): Promise<CommandOutput<"trace.affected">> => {
    const { graph, shortIds, element } = await startOf(ctx, input);
    const records = (await ctx.workspace.get(evidenceIndexState)).byElement.get(element.id) ?? [];
    let options: AffectedOptions = {};
    if (records.length > 0) {
      const current = (await currentVersionsOf(ctx.workspace, [element])).get(element);
      if (current?.kind === "version") {
        options = { evidence: { version: current.forms, records } };
      }
    }
    const output = affectedOutput(
      traceAffected(graph, element, options),
      { metamodel: graph.metamodel, shortIds },
      { limit: input.limit, offset: input.offset },
    );
    // Copies with their evidence source (#821): the index records stay as they are.
    const name = await recordNamer(ctx.workspace, [{ element, records: output.records }]);
    return { ...output, records: output.records.map((record) => name(element, withEvidenceSource(record))) };
  },
  // Every affected element, without its way, distance or the records of older versions.
  outputElements: async (ctx, input) => {
    const { graph, element } = await startOf(ctx, input);
    const affected = traceAffected(graph, element);
    return {
      elements: [...affected.reached.keys()].filter((reached) => reached !== element),
      incomplete: affected.incomplete,
    };
  },
});
