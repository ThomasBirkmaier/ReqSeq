// evidence.list (SR-032): the evidence records of one element, newest first, each with its version,
// item (Prüfling), date, result and evidence (Beleg) (AK1) and the names of the baselines that
// contain its version (AK2, read-only baseline reader, spec question ThomasBirkmaier/ReqSeq-archive#530; a baseline entry of the
// other normal form counts when both are of the current version, ADR-0005 "Normal form 2"). `view` keeps the records
// of the core or of one variant (SR-047), in a variant with those without variant when the element's
// repository is marked `variant-independent` (SR-173). `problems` are those of the baseline files; `incomplete`
// says that an evidence location or the baselines folder is not on this machine (SR-006 AK2).
// `testCases` are the test cases that name the element, each with the element's executions that hold
// in the view (SR-033, `testCasesIn`; every kind of record, as `records`). Nothing is written.
import { workspaceBaselines, baselinesContaining } from "../../baselines/index.js";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { evidenceIndexState, evidenceReadState, listedRecords, testCasesIn } from "../../evidence/index.js";
import { metamodelState } from "../../metamodel/index.js";
import {
  currentVersionsOf,
  elementStoreState,
  formsOfEntry,
  resolveRef,
  shortIdState,
  storedForms,
} from "../../model/index.js";
import { resolveView } from "../../variants/index.js";
import { variantIndependentOf, workspaceLayoutState } from "../../workspace/index.js";

export default defineCommand({
  name: "evidence.list",
  run: async (ctx, input): Promise<CommandOutput<"evidence.list">> => {
    const store = await ctx.workspace.get(elementStoreState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const element = resolveRef(store, shortIds, input.ref);
    const view =
      input.view === undefined
        ? undefined
        : resolveView(
            { metamodel: await ctx.workspace.get(metamodelState), store, shortIds },
            input.view,
            "evidence.list",
          );
    const index = await ctx.workspace.get(evidenceIndexState);
    const read = await ctx.workspace.get(evidenceReadState);
    const baselines = await workspaceBaselines(ctx.workspace);
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const independent = variantIndependentOf(layout).has(element.repository);
    // A baseline of the other normal form than a record contains it when both are of the current version.
    // Read only for an element with records.
    const records = index.byElement.get(element.id) ?? [];
    const current =
      records.length === 0
        ? undefined
        : formsOfEntry((await currentVersionsOf(ctx.workspace, [element])).get(element));
    return {
      records: listedRecords(records, view, independent, (id, version) =>
        baselinesContaining(baselines, id, storedForms(version, current)),
      ),
      testCases: testCasesIn(index, element.id, view, independent),
      problems: [...baselines.problems],
      incomplete: read.incomplete || baselines.incomplete,
    };
  },
});
