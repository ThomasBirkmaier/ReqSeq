// element.setStatus (SR-017, SR-087): sets a status of the metamodel on elements, on explicit request
// of the caller. Only the status line changes; any value that is not a status of the metamodel is
// refused (D-030, ADR-0002 rule 6). See model/status.ts.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { setElementStatus } from "../../model/index.js";

export default defineCommand({
  name: "element.setStatus",
  run: async (ctx, input): Promise<CommandOutput<"element.setStatus">> => {
    const { files, problems } = await setElementStatus(ctx.workspace, input);
    return { files: [...files], problems: [...problems] };
  },
});
