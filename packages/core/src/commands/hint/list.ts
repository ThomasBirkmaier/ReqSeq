// hint.list (SR-026; lists the hints of SR-040 AK3 and SR-072 AK2, and from stage 5 those of
// SR-045 and SR-103): the open hints of the workspace, filtered by kind, type, package, variant or
// element, each with kind, element, target and reason, and `incomplete` (hints/list.ts).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { listHints } from "../../hints/index.js";

export default defineCommand({
  name: "hint.list",
  run: async (ctx, input): Promise<CommandOutput<"hint.list">> => listHints(ctx.workspace, input),
});
