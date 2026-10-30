// element.update (SR-001, SR-102, SR-106): changes title, text or properties of one element. Only the lines
// of the changed keys and the text are rewritten; unknown properties, the file name and the UUID
// stay. Status changes only through element.setStatus (ADR-0002 rule 6). `affected` is the number
// of directly affected elements when the save changed the version, else 0 (SR-024 AK2, AK3). See
// model/write.ts. `expectedFileSha256` is the caller's write precondition, `fileSha256` the hash of
// the file as written for the next save (SR-106); `repository` picks one copy of a duplicate as in
// element.get (#255). A variant is not written with validity entries (SR-039 AK2, variants/nested.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { updateElement } from "../../model/index.js";
import { elementHints } from "../../hints/index.js";
import { nestedVariantCheck } from "../../variants/index.js";

export default defineCommand({
  name: "element.update",
  run: async (ctx, input): Promise<CommandOutput<"element.update">> => {
    const { element, fileSha256, files, problems, affected } = await updateElement(
      ctx.workspace,
      input,
      elementHints,
      await nestedVariantCheck(ctx.workspace, "element.update"),
    );
    return { element, fileSha256, files: [...files], affected, problems: [...problems] };
  },
});
