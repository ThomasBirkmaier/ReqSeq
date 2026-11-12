// metamodel.get (SR-012, SR-013): the metamodel of the checked-out state as the tool uses it
// (`metamodel/output.ts`).
import { defineCommand } from "../../catalog.js";
import { metamodelOutput } from "../../metamodel/index.js";

export default defineCommand({
  name: "metamodel.get",
  run: (ctx) => metamodelOutput(ctx.workspace),
});
