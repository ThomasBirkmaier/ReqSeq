// metamodel.get (SR-012, SR-013): the metamodel of the checked-out state as the tool uses it. The
// types with inheritance resolved, the other definitions as written, the keys assigned to each
// built-in meaning (empty when none, SR-013 AK3) and the problems of the metamodel. Also works on a
// read-only workspace (SR-011 AK3), with whatever the valid files define.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { metamodelProblems, metamodelState } from "../../metamodel/index.js";

export default defineCommand({
  name: "metamodel.get",
  run: async (ctx): Promise<CommandOutput<"metamodel.get">> => {
    const metamodel = await ctx.workspace.get(metamodelState);
    return {
      types: metamodel.effectiveTypes,
      properties: metamodel.properties,
      relations: metamodel.relations,
      statuses: metamodel.statuses,
      meanings: metamodel.meanings,
      problems: await metamodelProblems(ctx.workspace),
    };
  },
});
