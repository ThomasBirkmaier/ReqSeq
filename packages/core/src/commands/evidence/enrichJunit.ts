// evidence.enrichJunit (SR-029): adds UUID, version, item and date to every test case of a JUnit XML
// file that names an element, and writes the file in place or to `output` (evidence/enrich.ts).
import { defineCommand } from "../../catalog.js";
import { enrichJunitFile } from "../../evidence/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "evidence.enrichJunit",
  answer: (output) =>
    sentence(
      `Enriched ${counted(output.testCases, "test case")}`,
      output.withoutReference === 0
        ? ""
        : `${counted(output.withoutReference, "test case")} without an element`,
      output.unknown.length === 0 ? "" : counted(output.unknown.length, "unknown reference"),
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: (ctx, input) => enrichJunitFile(ctx.workspace, input),
});
