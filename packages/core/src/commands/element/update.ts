// element.update (SR-001, SR-102): changes title, text or properties of one element. Only the lines
// of the changed keys and the text are rewritten; unknown properties, the file name and the UUID
// stay. Status changes only through element.setStatus (ADR-0002 rule 6). See model/write.ts.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { updateElement } from "../../model/index.js";

export default defineCommand({
  name: "element.update",
  run: async (ctx, input): Promise<CommandOutput<"element.update">> => {
    const { element, files, problems } = await updateElement(ctx.workspace, input);
    return { element, files: [...files], problems: [...problems] };
  },
});
