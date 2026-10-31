// Loaded with `--import` into the app's core process by the README animation (guide-animation.spec.ts): the
// next calls of `randomUUID` give the UUIDs in REQSEQ_TEST_UUIDS (comma-separated), in order, so the elements
// it creates get the IDs of Get started and the README (N-7fe707, SR-c67baa). Later calls are random again.
// Core calls `randomUUID` only for a new element (`model/write.ts`); the spec checks the IDs in the modeline.
// Only the core process (a utility process) is changed; the main process and the CLI are not.
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";

const queue = (process.env["REQSEQ_TEST_UUIDS"] ?? "").split(",").filter((id) => id !== "");
if (process.type === "utility" && queue.length > 0) {
  const random = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = (options) => queue.shift() ?? random(options);
  syncBuiltinESMExports();
}
