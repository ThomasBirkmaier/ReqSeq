// trace.chain (SR-006, SR-022, SR-033): the chain of one element up to the top parents and down to
// the evidence, with depth, gaps, cycles and `incomplete` (trace/chain.ts). The relation kinds come
// from the meaning `derivation` (SR-013 AK1, AK3); `view` keeps the elements that apply in the core
// or a variant holds (`viewRuleOf`: the validity, SR-040, less what a variant excludes or replaces,
// SR-041 AK5, SR-043 AK4). The walk is always complete; the output is one page of `limit` nodes from
// `offset` with `total` (SR-082 AK4, spec-frage ThomasBirkmaier/ReqSeq-archive#290), as `trace.related` and `trace.affected` give
// theirs. A variant's view is `incomplete` while a repository is not here (`viewIncomplete`).
//
// Evidence (SR-022 AK1, AK3; SR-033), only when the chain goes down: the evidence index decides the
// `no-evidence` gap of every element (`hasVerificationRecord` in the view, the core without one; any
// version and result, spec questions ThomasBirkmaier/ReqSeq-archive#527 Q3 and Q4), and gives the test cases and records below
// each expanded downward node of the page (`chainEvidenceOf`: verification records that hold in the
// view, every one without a view; assumptions A2 and A5 of ThomasBirkmaier/ReqSeq-archive#528 Q4). An evidence location that is
// not on this machine makes the chain `incomplete` (SR-006 AK2), in either direction, since the
// root's validation records (`validationRecords`, SR-038 AK1, #646) come in both: on the page with
// the root, every one, no view narrowing them (`validationRecordsOf`). The upward chain reads the
// index for them only; gaps and evidence stay those of the downward chain.
// Both take the mark of each element's repository (`variant-independent`, SR-173): in a variant a
// record without variant of a marked element holds too.
// `names` names the variants of those records (#676), as evidence.status names its views (ThomasBirkmaier/ReqSeq-archive#588).
// The records of the page name their criteria with number, key and text (`recordNamer`, SR-205 AK2).
//
// Not in view (#674, product owner decision, 2026-11-02): a requirement without a child that the view
// of the chain does not hold (`viewRuleOf(view ?? core).includes`, so SR-043 AK10 holds) is
// `not-in-view`, not `no-evidence`; with `view` only the root can be. Its `views` (`viewsOf`) are
// built only for the gaps of the page, with the rules of the core and of each variant read once per
// command (N-036), and `names` names those variants too. Without `view` the children still count in
// every view (unchanged).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  chainEvidenceOf,
  evidenceIndexState,
  evidenceReadState,
  hasVerificationRecord,
  testCaseWithEvidenceSource,
  validationRecordsOf,
  withEvidenceSource,
} from "../../evidence/index.js";
import type { ElementEvidence } from "../../evidence/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { recordNamer, withNamedExecutions } from "../../evidence/index.js";
import { zip } from "../../files/index.js";
import { namesField, namesOf, resolveRef, shortIdState } from "../../model/index.js";
import { chainOutput, derivationGraph, traceChain, traceContext } from "../../trace/index.js";
import type { View } from "../../variants/index.js";
import type { ElementRecord } from "../../model/index.js";
import {
  resolveView,
  variantsOf as variantElementsOf,
  viewIncomplete,
  viewRuleOf,
} from "../../variants/index.js";
import { variantIndependentOf } from "../../workspace/index.js";

const CORE: View = { kind: "core" };

/** The variants the records of the chain's evidence name, in the order named (with repeats). */
const variantsOf = (evidence: CommandOutput<"trace.chain">["evidence"]): string[] =>
  evidence
    .flatMap((item) => [
      ...item.testCases.flatMap((test) => test.executions.map((execution) => execution.variant)),
      ...item.records.map((record) => record.variant),
    ])
    .filter((variant): variant is string => variant !== undefined);

/** The views that hold an element (`core`, then variant UUIDs in store order), with each view's rule read once. */
const viewsHolding = (
  rules: () => readonly { readonly id: string; readonly includes: (e: ElementRecord) => boolean }[],
) => {
  let read: ReturnType<typeof rules> | undefined;
  return (element: ElementRecord): readonly string[] => {
    read ??= rules();
    return read.filter((rule) => rule.includes(element)).map((rule) => rule.id);
  };
};

/**
 * Copies of the evidence below an element with their evidence source (#821): the index records and
 * test cases stay as they are, and only the expanded elements of the page are copied.
 */
const withEvidenceSources = (evidence: ElementEvidence | undefined): ElementEvidence | undefined =>
  evidence === undefined
    ? undefined
    : {
        testCases: evidence.testCases.map(testCaseWithEvidenceSource),
        records: evidence.records.map(withEvidenceSource),
      };

type ChainEvidence = NonNullable<CommandOutput<"trace.chain">["evidence"]>;

/**
 * `evidence` with the criteria its records name (SR-205 AK2); `below` are the elements whose evidence
 * `chainOutput` asked for, in its order, with what it got: the items of `evidence` are those that
 * gave any, in that order.
 */
const namedEvidence = async (
  workspace: Workspace,
  below: readonly { readonly element: ElementRecord; readonly leaf: ElementEvidence | undefined }[],
  evidence: ChainEvidence,
): Promise<ChainEvidence> => {
  const shown = below.flatMap(({ element, leaf }) =>
    leaf === undefined
      ? []
      : [{ element, records: [...leaf.records, ...leaf.testCases.flatMap((t) => t.executions)] }],
  );
  // An element below several nodes of the page is named once.
  const name = await recordNamer(workspace, [...new Map(shown.map((e) => [e.element, e])).values()]);
  return zip(evidence, shown).map(([item, { element }]) => ({
    ...item,
    testCases: item.testCases.map((test) => withNamedExecutions(name, element, test)),
    records: item.records.map((record) => name(element, record)),
  }));
};

export default defineCommand({
  name: "trace.chain",
  run: async (ctx, input): Promise<CommandOutput<"trace.chain">> => {
    const graph = derivationGraph(await traceContext(ctx.workspace), "trace.chain");
    const { metamodel, store } = graph;
    const shortIds = await ctx.workspace.get(shortIdState);
    const root = resolveRef(store, shortIds, input.ref, {
      repository: input.repository,
      file: input.file,
    });
    const view =
      input.view === undefined
        ? undefined
        : resolveView({ metamodel, store, shortIds }, input.view, "trace.chain");
    const down = input.direction !== "up";
    const all = await ctx.workspace.get(evidenceIndexState);
    const read = await ctx.workspace.get(evidenceReadState);
    const index = down ? all : undefined;
    const gapView = view ?? CORE;
    const marked = variantIndependentOf(graph.layout);
    const independent = (element: ElementRecord): boolean => marked.has(element.repository);
    const ruleContext = { workspace: ctx.workspace, store, metamodel };
    const held = viewRuleOf(ruleContext, gapView).includes;
    const viewsOf = viewsHolding(() => [
      { id: "core", includes: viewRuleOf(ruleContext, CORE).includes },
      ...variantElementsOf(store, metamodel).map((variant) => ({
        id: variant.id,
        includes: viewRuleOf(ruleContext, { kind: "variant", variant }).includes,
      })),
    ]);
    const chain = traceChain(graph, root, {
      direction: input.direction,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
      ...(view === undefined ? {} : { includes: viewRuleOf(ruleContext, view).includes }),
      ...(index === undefined
        ? {}
        : {
            hasEvidence: (element) => hasVerificationRecord(index, element.id, gapView, independent(element)),
            outsideView: (element) => !held(element),
          }),
    });
    // The evidence below the elements of the page, for naming the criteria of its records.
    const below: { element: ElementRecord; leaf: ElementEvidence | undefined }[] = [];
    const output = chainOutput(
      chain,
      {
        metamodel,
        shortIds,
        viewsOf,
        validationOf: (element) => validationRecordsOf(all, element.id).map(withEvidenceSource),
        ...(index === undefined
          ? {}
          : {
              evidenceOf: (element) => {
                const leaf = withEvidenceSources(
                  chainEvidenceOf(index, element.id, view, independent(element)),
                );
                below.push({ element, leaf });
                return leaf;
              },
            }),
      },
      { limit: input.limit, offset: input.offset },
    );
    // The criteria of the records shown, named with number, key and text (SR-205 AK2).
    const evidence = await namedEvidence(ctx.workspace, below, output.evidence);
    const named = {
      ...output,
      evidence,
      ...namesField(
        namesOf({ metamodel, store, shortIds }, [
          ...variantsOf(output.evidence),
          ...output.gaps.flatMap((gap) => (gap.views ?? []).filter((id) => id !== "core")),
        ]),
      ),
    };
    return read.incomplete || viewIncomplete(graph.layout, view) ? { ...named, incomplete: true } : named;
  },
});
