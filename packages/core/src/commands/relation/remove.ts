// relation.remove (enabler ThomasBirkmaier/ReqSeq-archive#264, SR-102, D-045): removes one relation from the source file
// (model/relation-write.ts). No element and no file is deleted; the target file is not touched.
// Nothing to remove is an `info` problem `relation.not-found`.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { removeRelation } from "../../model/index.js";
import { filesNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "relation.remove",
  answer: (output, input) =>
    sentence(
      output.files.length === 0
        ? `Removed no ${input.kind} relation from ${input.source} to ${input.target}`
        : `Removed the ${input.kind} relation from ${input.source} to ${input.target}`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"relation.remove">> => {
    const { files, problems } = await removeRelation(ctx.workspace, input);
    return { files: [...files], problems: [...problems] };
  },
});
