// element.supersede (SR-072, SR-087): sets a status the metamodel marks invalid and, on request, a
// relation with the meaning succession from the successor; returns the hints on relations to the
// superseded element. There is no delete (D-045, SR-099). See model/supersede.ts.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { supersedeElement } from "../../model/index.js";

export default defineCommand({
  name: "element.supersede",
  run: async (ctx, input): Promise<CommandOutput<"element.supersede">> => {
    const { files, problems } = await supersedeElement(ctx.workspace, input);
    return { files: [...files], problems: [...problems] };
  },
});
