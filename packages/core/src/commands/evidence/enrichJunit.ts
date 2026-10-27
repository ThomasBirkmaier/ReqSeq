// evidence.enrichJunit (SR-029): adds UUID, version, item and date to every test case of a JUnit XML
// file that names an element, and writes the file in place or to `output` (evidence/enrich.ts).
import { defineCommand } from "../../catalog.js";
import { enrichJunitFile } from "../../evidence/index.js";

export default defineCommand({
  name: "evidence.enrichJunit",
  run: (ctx, input) => enrichJunitFile(ctx.workspace, input),
});
