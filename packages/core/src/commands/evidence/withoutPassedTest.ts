// evidence.withoutPassedTest (SR-120, #431): every requirement without a passed test execution in one view
// (`withoutPassedTest` of the evidence block, the rules and the assumptions of spec question #532 are there),
// one page at a time, by type, then identifier (else short ID): the keys of the app's `DEFAULT_SORT`
// (`packages/app/src/renderer/buffers.ts`), so the list reads as the app's lists do; change both. Each
// element as evidence.status gives it, with `verification` and `validation` (`withEvidenceStatus`), so
// a row says why it is listed; `names` names the variants and missing children those rows give by UUID only
// (#588), from the store. The view is `view`, else the core, as the view rule holds it (`viewRuleOf`:
// no requirement a variant excludes or replaces, SR-043); it takes no selection (SR-120 asks for
// „alle Requirements“), so the command prompt runs it without asking (AK1). `incomplete` (SR-006 AK2): a
// repository of the workspace, or of an evidence location, is not on this machine. Only the page is
// prepared and built (N-036); nothing is written (D-030).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  evidenceReadState,
  verificationNameIds,
  verificationState,
  viewIdOf,
  withEvidenceStatus,
  withoutPassedTest,
  workspaceStatus,
} from "../../evidence/index.js";
import type { FilterSortKeyWithDefaults } from "../../generated/types.js";
import { listElements, namesField, namesOf } from "../../model/index.js";
import { resolveSelection, sortElements } from "../../query/index.js";
import type { View } from "../../variants/index.js";
import { resolveView, viewRuleOf } from "../../variants/index.js";

const CORE: View = Object.freeze({ kind: "core" });

/** The order of the list: the keys of the app's `DEFAULT_SORT`. */
const BY_TYPE_AND_IDENTIFIER: readonly FilterSortKeyWithDefaults[] = Object.freeze([
  Object.freeze({ by: "type", order: "asc" }),
  Object.freeze({ by: "identifier", order: "asc" }),
] as const);

export default defineCommand({
  name: "evidence.withoutPassedTest",
  run: async (ctx, input): Promise<CommandOutput<"evidence.withoutPassedTest">> => {
    const command = "evidence.withoutPassedTest";
    const selected = await resolveSelection(ctx.workspace, {}, command);
    const view = input.view === undefined ? CORE : resolveView(selected, input.view, command);
    const status = await ctx.workspace.get(verificationState);
    const inView = viewRuleOf({ workspace: ctx.workspace, ...selected }, view).includes;
    const listed = withoutPassedTest(status.source, selected.elements.filter(inView), view);
    const sorted = sortElements({ ...selected, command }, listed, BY_TYPE_AND_IDENTIFIER).elements;
    const page = sorted.slice(input.offset, input.offset + input.limit);
    const shown = await workspaceStatus(ctx.workspace, page);
    const elements = await listElements(ctx.workspace, selected, page, {
      extend: (record, element) => withEvidenceStatus(shown, record, element),
    });
    const read = await ctx.workspace.get(evidenceReadState);
    return {
      elements,
      total: listed.length,
      view: viewIdOf(view),
      incomplete: selected.incomplete || read.incomplete,
      // Every listed element is a requirement, so each has `verification`; the filter only satisfies the type.
      ...namesField(
        namesOf(
          selected,
          verificationNameIds(elements.flatMap((e) => e.verification).filter((v) => v !== undefined)),
        ),
      ),
    };
  },
});
