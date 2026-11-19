// perspective.rename (SR-217 AK1 to AK3, AK7): gives a perspective a new name; its file is renamed to
// the name part of the new name (AK2), comments on unchanged lines and the description stay. The
// logic is `renamePerspective` (query/saved-rename.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { renamePerspective } from "../../query/index.js";
import { filesNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "perspective.rename",
  answer: (output, input) =>
    sentence(
      `Renamed perspective ${input.name} to ${input.newName}`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"perspective.rename">> => {
    const { files, renamed, problems } = await renamePerspective(ctx.workspace, input.name, input.newName);
    return { files, renamed, problems };
  },
});
