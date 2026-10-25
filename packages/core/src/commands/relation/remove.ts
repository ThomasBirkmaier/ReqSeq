// relation.remove (enabler #264, SR-102, D-045): removes one relation from the source file
// (model/relation-write.ts). No element and no file is deleted; the target file is not touched.
// Nothing to remove is an `info` problem `relation.not-found`.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { removeRelation } from "../../model/index.js";

export default defineCommand({
  name: "relation.remove",
  run: async (ctx, input): Promise<CommandOutput<"relation.remove">> => {
    const { files, problems } = await removeRelation(ctx.workspace, input);
    return { files: [...files], problems: [...problems] };
  },
});
