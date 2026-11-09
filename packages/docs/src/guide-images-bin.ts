import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkGuideImages, guideImagesReport, updatedImages } from "./guide-images.js";

// The CI step "Guide screenshots changed" (#1258): reports the screenshots of the guide that a pull request changes
// without updating their copies, after the Electron run wrote the current ones. The workflow passes the images the pull
// request changed (`GUIDE_IMAGES_UPDATED`, the output of `git diff --name-only`) and the cache key of main's
// screenshots (`GUIDE_IMAGES_MAIN_KEY`). Its exit code is 0 unless the comparison itself breaks.
const { log, summary } = guideImagesReport(
  await checkGuideImages(
    fileURLToPath(new URL("../../../", import.meta.url)),
    updatedImages(process.env["GUIDE_IMAGES_UPDATED"] ?? ""),
  ),
  process.env["GUIDE_IMAGES_MAIN_KEY"],
);
process.stdout.write(log);
// GitHub sets the summary file in every step; a local run has none.
const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile !== undefined && summary !== "") {
  await appendFile(summaryFile, summary);
}
