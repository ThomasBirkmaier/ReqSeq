// evidence.list (SR-032): the evidence records of one element, newest first, each with its version,
// item (Prüfling), date, result and evidence (Beleg) (AK1) and the names of the baselines that
// contain its version (AK2, read-only baseline reader, spec question #530). `view` keeps the records
// of the core or of one variant (SR-047). `problems` are those of the baseline files; `incomplete`
// says that an evidence location or the baselines folder is not on this machine (SR-006 AK2).
// `testCases` are the test cases that name the element, each with the element's executions that hold
// in the view (SR-033, `testCasesIn`; every kind of record, as `records`). Nothing is written.
import { workspaceBaselines, baselinesContaining } from "../../baselines/index.js";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { evidenceIndexState, evidenceReadState, listedRecords, testCasesIn } from "../../evidence/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, resolveRef, shortIdState } from "../../model/index.js";
import { resolveView } from "../../variants/index.js";

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
    return {
      records: listedRecords(index.byElement.get(element.id) ?? [], view, (id, version) =>
        baselinesContaining(baselines, id, version),
      ),
      testCases: testCasesIn(index, element.id, view),
      problems: [...baselines.problems],
      incomplete: read.incomplete || baselines.incomplete,
    };
  },
});
