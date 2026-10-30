// element.get (SR-005, SR-006, SR-016, SR-040 AK3, SR-072 AK3, SR-084, SR-085, SR-086, SR-088, SR-091): one
// element with text, properties, version, relations, the successors of a superseded element and its
// hints, read from its file as it is now, with the SHA-256 of that file (`fileSha256`, the write
// precondition of element.update, SR-106); `repository` and `file` pick one copy of a duplicate
// (#255). Its verification status in the core and each variant it applies in, with the children
// that are missing for an indirect verification, and its validation status come from the evidence
// block (SR-031, SR-034, SR-038, `withEvidenceStatus`), measured against the version shown. What
// stage 1 leaves out: see model/get.ts. `view` (SR-043, stage 5) is refused until variants exist, so a
// caller never takes the whole element for the view of a variant. `versionDate` dates the version of
// the element and its outdated relations (D-013, ADR-0005); `hintDates` only the outdated relations,
// which the app shows at the reference (SR-110 AK2, #702): Git then reads only the histories of
// their targets, and nothing when the element has none. A core requirement names the variants that
// replace it (with the replacement) and those that exclude it (`replacedBy`, `excludedBy`, SR-046
// AK3), by the view rule over the store (`replacedExcludedOf`). `names` names the variants of its
// validity, those and the replacements, and the views of `verification`, so the app and the CLI
// show titles (SR-046 AK1/AK2, #588). `incomplete`: a repository of the workspace is not here, so
// replacements, exclusions and records stored there are missing (SR-006 AK2).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { exportedProperties, targetIds, withReplacedExcluded } from "../../data/index.js";
import { variantIdsOf, withEvidenceStatus, workspaceStatus } from "../../evidence/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { ElementHints } from "../../model/index.js";
import { elementStoreState, getElement, namesField, namesOf, shortIdState } from "../../model/index.js";
import { elementHints } from "../../hints/index.js";
import { replacedExcludedOf } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

export default defineCommand({
  name: "element.get",
  run: async (ctx, input): Promise<CommandOutput<"element.get">> => {
    if (input.view !== undefined) {
      throw new CommandError(
        "input.invalid",
        "element.get cannot show the view of a variant yet (SR-043): leave out view",
        { command: "element.get", fields: ["view"] },
      );
    }
    // The variants and hints blocks import the model, so their hints are added here (SR-040 AK3, SR-026 AK3).
    const hints: ElementHints = (context, record, withDate) =>
      elementHints(context, record, withDate || input.hintDates);
    const { element, record, fileSha256 } = await getElement(
      ctx.workspace,
      input.ref,
      hints,
      input.versionDate,
      {
        repository: input.repository,
        file: input.file,
      },
    );
    const [store, metamodel, shortIds, layout] = await Promise.all([
      ctx.workspace.get(elementStoreState),
      ctx.workspace.get(metamodelState),
      ctx.workspace.get(shortIdState),
      ctx.workspace.get(workspaceLayoutState),
    ]);
    const uses = replacedExcludedOf({ workspace: ctx.workspace, store, metamodel }, record);
    const shown = withReplacedExcluded(
      uses,
      withEvidenceStatus(await workspaceStatus(ctx.workspace, [record]), record, element),
    );
    const validity = exportedProperties(metamodel).validity;
    const named = [
      ...(validity === undefined ? [] : targetIds(validity, record)),
      ...uses.replacedBy.flatMap((u) => [u.variant.id, u.replacement.id]),
      ...uses.excludedBy.map((v) => v.id),
      ...(shown.verification ?? []).flatMap((entry) => variantIdsOf(entry.view)),
    ];
    return {
      element: shown,
      fileSha256,
      ...namesField(namesOf({ metamodel, store, shortIds }, named)),
      ...(layout.repositories.some((r) => !r.available) ? { incomplete: true } : {}),
    };
  },
});
