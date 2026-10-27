// evidence.record (SR-030): writes a manual verification or validation record into an evidence folder,
// with the UUID and current version of the element filled in (evidence/write-record.ts).
import { defineCommand } from "../../catalog.js";
import { recordEvidence } from "../../evidence/index.js";

export default defineCommand({
  name: "evidence.record",
  run: (ctx, input) => recordEvidence(ctx.workspace, input),
});
