// trace.mermaid (SR-151 AK1, AK4, AK6): the graph of trace.graph for the same input, without the evidence,
// as a Mermaid flowchart (`graph/mermaid.ts`), with the names of the types and kinds of metamodel.get.
import { defineCommand } from "../../catalog.js";
import { elementGraphOf, elementMermaid, relationNames } from "../../graph/index.js";
import { metamodelOutput } from "../../metamodel/index.js";

export default defineCommand({
  name: "trace.mermaid",
  run: async (ctx, input) => {
    const { output } = await elementGraphOf(ctx.workspace, input, "trace.mermaid");
    const metamodel = await metamodelOutput(ctx.workspace);
    const typeNames = new Map(metamodel.types.map((type) => [type.key, type.name]));
    return {
      mermaid: elementMermaid(output, typeNames, relationNames(metamodel)),
      truncated: output.truncated,
      incomplete: output.incomplete,
      problems: output.problems,
    };
  },
});
