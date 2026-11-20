// evidence.list (SR-032): the evidence records of one element, newest first, each with its version,
// item (Prüfling), date, result and evidence (Beleg) (AK1) and the names of the baselines that
// contain its version (AK2, read-only baseline reader, spec question ThomasBirkmaier/ReqSeq-archive#530; a baseline entry of the
// other normal form counts when both are of the current version, ADR-0005 "Normal form 2"). `view` keeps the records
// of the core or of one variant (SR-047), in a variant with those without variant when the element's
// repository is marked `variant-independent` (SR-173). `problems` are those of the baseline files; `incomplete`
// says that an evidence location or the baselines folder is not on this machine (SR-006 AK2).
// `testCases` are the test cases that name the element, each with the element's executions that hold
// in the view (SR-033, `testCasesIn`; every kind of record, as `records`). Every record carries its
// `evidenceSource` (#821) and, where it names criteria (also in `testCases`), their numbers, keys and texts
// (`criterionNames`, SR-205 AK2). `bearing` names the records that bear the status (AK3, `bearingRecords`), and `display` groups them for the
// app (AK3 to AK5, `elementDisplay`, the rule the HTML export shows too, SR-232 AK3, over the views the element applies in, without that of a variant
// whose status is invalid unless `view` names it, SR-047 AK6). Nothing is written.
import { workspaceBaselines, baselinesContaining } from "../../baselines/index.js";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  elementDisplay,
  evidenceIndexState,
  evidenceReadState,
  listedRecords,
  recordNamer,
  withNamedExecutions,
  testCaseWithEvidenceSource,
  testCasesIn,
  verificationState,
  withEvidenceSource,
} from "../../evidence/index.js";
import type { ElementDisplay } from "../../evidence/index.js";
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
import { counted, incompleteNote, problemsNote, sentence } from "../answer.js";

/** The display of an element without records. */
const NO_DISPLAY: ElementDisplay = { bearing: [], display: { shared: {}, rows: [], older: [] } };

export default defineCommand({
  name: "evidence.list",
  answer: (output, input, names) =>
    sentence(
      `Found ${counted(output.records.length, "evidence record")} and ${counted(output.testCases.length, "test case")} of ${names.element(input.ref, { repository: input.repository, file: input.file })}`,
      problemsNote(output.problems),
      incompleteNote(output.incomplete),
    ),
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
    // The status, its views and criteria are read only for an element with records.
    const status = listed.length === 0 ? undefined : await ctx.workspace.get(verificationState);
    const testCases = testCasesIn(index, element.id, view, independent).map(testCaseWithEvidenceSource);
    // Every record listed, also those of the test cases, with its criteria named (SR-205 AK2).
    const name = await recordNamer(ctx.workspace, [
      { element, records: listed },
      { element, records: testCases.flatMap((t) => t.executions) },
    ]);
    const named = listed.map((record) => name(element, record));
    const { bearing, display } =
      status === undefined ? NO_DISPLAY : elementDisplay(status, element, current, named, view);
    return {
      records: named,
      bearing,
      display,
      testCases: testCases.map((test) => withNamedExecutions(name, element, test)),
      problems: [...baselines.problems],
      incomplete: read.incomplete || baselines.incomplete,
    };
  },
});
