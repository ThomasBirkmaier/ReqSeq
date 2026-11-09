import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkGuideImages, guideImagesReport } from "./guide-images.js";

// The CI step "Guide screenshots" (#1258): reports the committed screenshots of the guide that no longer show the app,
// after the Electron run wrote the current ones. Its exit code is 0 unless the comparison itself breaks.
const { log, summary } = guideImagesReport(
  await checkGuideImages(fileURLToPath(new URL("../../../", import.meta.url))),
);
process.stdout.write(log);
// GitHub sets the summary file in every step; a local run has none.
const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile !== undefined && summary !== "") {
  await appendFile(summaryFile, summary);
}
