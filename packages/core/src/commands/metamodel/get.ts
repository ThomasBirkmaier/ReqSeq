// metamodel.get (SR-012, SR-013): the metamodel of the checked-out state as the tool uses it
// (`metamodel/output.ts`), with the uses of each definition (SR-236 AK8, `model/metamodel-uses.ts`).
import { defineCommand } from "../../catalog.js";
import { metamodelOutput } from "../../metamodel/index.js";
import { metamodelUsesState } from "../../model/index.js";

export default defineCommand({
  name: "metamodel.get",
  run: async (ctx) => ({
    ...(await metamodelOutput(ctx.workspace)),
    uses: await ctx.workspace.get(metamodelUsesState),
  }),
});
