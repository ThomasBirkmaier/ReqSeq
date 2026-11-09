// evidence.list (SR-032): the evidence records of one element, newest first, each with its version,
// item (Prüfling), date, result and evidence (Beleg) (AK1) and the names of the baselines that
// contain its version (AK2, read-only baseline reader, spec question ThomasBirkmaier/ReqSeq-archive#530; a baseline entry of the
// other normal form counts when both are of the current version, ADR-0005 "Normal form 2"). `view` keeps the records
// of the core or of one variant (SR-047), in a variant with those without variant when the element's
// repository is marked `variant-independent` (SR-173). `problems` are those of the baseline files; `incomplete`
// says that an evidence location or the baselines folder is not on this machine (SR-006 AK2).
// `testCases` are the test cases that name the element, each with the element's executions that hold
// in the view (SR-033, `testCasesIn`; every kind of record, as `records`). Every record carries its
// `evidenceSource` (#821). `bearing` names the records that bear the status (AK3, `bearingRecords`), and `display` groups them for the
// app (AK3 to AK5, `displayOf`, over the views the element applies in). Nothing is written.
import { workspaceBaselines, baselinesContaining } from "../../baselines/index.js";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  bearingRecords,
  displayOf,
  evidenceIndexState,
  evidenceReadState,
  listedRecords,
  testCaseWithEvidenceSource,
  testCasesIn,
  verificationState,
  withEvidenceSource,
} from "../../evidence/index.js";
import { metamodelState } from "../../metamodel/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaCount,
  currentVersionsOf,
  elementStoreState,
  formsOfEntry,
  resolveRef,
  shortIdState,
  storedForms,
} from "../../model/index.js";
import type { View } from "../../variants/index.js";
import { resolveView } from "../../variants/index.js";
import { variantIndependentOf, workspaceLayoutState } from "../../workspace/index.js";

/** Whether `holder` is `asked` (any view when none is asked). */
const sameView = (holder: View, asked: View | undefined): boolean =>
  asked === undefined ||
  (holder.kind === "core"
    ? asked.kind === "core"
    : asked.kind === "variant" && asked.variant.id === holder.variant.id);

export default defineCommand({
  name: "evidence.list",
  run: async (ctx, input): Promise<CommandOutput<"evidence.list">> => {
    const store = await ctx.workspace.get(elementStoreState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const element = resolveRef(store, shortIds, input.ref, {
      repository: input.repository,
      file: input.file,
    });
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
    // Copies with their evidence source (#821): the index records and test cases stay as they are.
    const listed = listedRecords(records, view, independent, (id, version) =>
      baselinesContaining(baselines, id, storedForms(version, current)),
    ).map(withEvidenceSource);
    const count =
      listed.length === 0
        ? 0
        : criteriaCount(element.data, acceptanceCriteriaKeyOf(await ctx.workspace.get(metamodelState)));
    const bearing = bearingRecords(listed, current, count, independent);
    // The views the element applies in (the view rule of the status, as `verificationOf`), with
    // `view` that one alone, as `listed` holds only its records; none for an element that is no
    // requirement. Read only for an element with records.
    const status = listed.length === 0 ? undefined : await ctx.workspace.get(verificationState);
    const views =
      status?.source.requirements.has(element.type) !== true
        ? []
        : status.holders
            .filter(({ view: holder, includes }) => includes(element) && sameView(holder, view))
            .map(({ view: holder }) => holder);
    return {
      records: listed,
      bearing,
      display: displayOf(listed, { bearing, current, count, views, independent }),
      testCases: testCasesIn(index, element.id, view, independent).map(testCaseWithEvidenceSource),
      problems: [...baselines.problems],
      incomplete: read.incomplete || baselines.incomplete,
    };
  },
});
