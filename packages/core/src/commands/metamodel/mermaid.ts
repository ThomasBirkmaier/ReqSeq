// metamodel.mermaid (SR-151 AK2, AK4): the graph of the metamodel of metamodel.get as a Mermaid flowchart
// (`graph/mermaid.ts`), with the problems of metamodel.get.
import { defineCommand } from "../../catalog.js";
import { metamodelMermaid } from "../../graph/index.js";
import { metamodelOutput } from "../../metamodel/index.js";
import { problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "metamodel.mermaid",
  answer: (output) => sentence("Drew the metamodel as a Mermaid flowchart", problemsNote(output.problems)),
  run: async (ctx) => {
    const output = await metamodelOutput(ctx.workspace);
    return { mermaid: metamodelMermaid(output), problems: output.problems };
  },
});
