// trace.mermaid (SR-151 AK1, AK4, AK6): the graph of trace.graph for the same input, without the evidence,
// as a Mermaid flowchart (`graph/mermaid.ts`), with the names of the types and kinds of its metamodel.
import { defineCommand } from "../../catalog.js";
import { elementGraphOf, elementMermaid, relationNames } from "../../graph/index.js";

export default defineCommand({
  name: "trace.mermaid",
  run: async (ctx, input) => {
    const { output, base } = await elementGraphOf(ctx.workspace, input, "trace.mermaid");
    const { metamodel } = base;
    const typeNames = new Map(metamodel.effectiveTypes.map((type) => [type.key, type.name]));
    return {
      mermaid: elementMermaid(output, typeNames, relationNames(metamodel)),
      truncated: output.truncated,
      incomplete: output.incomplete,
      problems: output.problems,
    };
  },
});
