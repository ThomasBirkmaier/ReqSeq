// hint.confirm (SR-027, D-042; SR-087 AK2, SR-102 AK1): writes the current version of the target
// into each relation item or inline reference a hint ID names, and nothing else; IDs that confirm
// nothing come back as problems (hints/confirm.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { confirmHints } from "../../hints/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "hint.confirm",
  answer: (output) =>
    sentence(
      `Confirmed ${counted(output.confirmed.length, "hint")}`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"hint.confirm">> => confirmHints(ctx.workspace, input),
});
