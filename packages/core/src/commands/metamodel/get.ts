// metamodel.get (SR-012, SR-013): the metamodel of the checked-out state as the tool uses it
// (`metamodel/output.ts`).
import { defineCommand } from "../../catalog.js";
import { metamodelOutput } from "../../metamodel/index.js";
import { counted, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "metamodel.get",
  answer: (output) =>
    sentence(
      `The metamodel has ${counted(output.types.length, "type")}, ${counted(output.properties.length, "property", "properties")}, ${counted(output.relations.length, "relation kind")} and ${counted(output.statuses.length, "status", "statuses")}`,
      problemsNote(output.problems),
    ),
  run: (ctx) => metamodelOutput(ctx.workspace),
});
