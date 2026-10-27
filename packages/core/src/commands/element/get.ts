// element.get (SR-005, SR-006, SR-016, SR-040 AK3, SR-072 AK3, SR-084, SR-085, SR-086, SR-088, SR-091): one
// element with text, properties, version, relations, the successors of a superseded element and its
// hints, read from its file as it is now, with the SHA-256 of that file (`fileSha256`, the write
// precondition of element.update, SR-106); `repository` and `file` pick one copy of a duplicate
// (#255). Its verification status in the core and each variant it applies in, with the children
// that are missing for an indirect verification, and its validation status come from the evidence
// block (SR-031, SR-034, SR-038, `withEvidenceStatus`), measured against the version shown. What
// stage 1 leaves out: see model/get.ts. `view` (SR-043, stage 5) is refused until variants exist, so a
// caller never takes the whole element for the view of a variant.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { withEvidenceStatus, workspaceStatus } from "../../evidence/index.js";
import { getElement } from "../../model/index.js";
import { elementHints } from "../../hints/index.js";

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
    const { element, record, fileSha256 } = await getElement(
      ctx.workspace,
      input.ref,
      elementHints,
      input.versionDate,
      {
        repository: input.repository,
        file: input.file,
      },
    );
    return {
      element: withEvidenceStatus(await workspaceStatus(ctx.workspace, [record]), record, element),
      fileSha256,
    };
  },
});
