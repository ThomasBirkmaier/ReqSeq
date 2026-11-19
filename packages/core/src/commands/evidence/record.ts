// evidence.record (SR-030): writes a manual verification or validation record into an evidence folder,
// with the UUID and current version of the element filled in (evidence/write-record.ts).
import { defineCommand } from "../../catalog.js";
import { recordEvidence } from "../../evidence/index.js";
import { filesNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "evidence.record",
  answer: (output, input) =>
    sentence(
      `Recorded a ${output.record.kind} with result ${output.record.result} for ${input.ref}`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: (ctx, input) => recordEvidence(ctx.workspace, input),
});
