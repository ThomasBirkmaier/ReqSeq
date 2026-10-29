import { fileURLToPath } from "node:url";
import { assembleContent, contentPaths } from "./assemble.js";
import { checkExamples, readGuidePages, runReqseq, wordWarnings } from "./examples.js";

// `pnpm docs:generate`: runs the examples of the guide (SR-140 AK2), warns on pages above the word budget, and
// fills packages/docs/site/src/content/docs/ before the site is built (ADR-0017). A failing example rejects, so
// the process ends with a non-zero exit code and the build stops.
const paths = contentPaths(fileURLToPath(new URL("../", import.meta.url)));
const pages = await readGuidePages(paths.guideDir);
for (const warning of wordWarnings(pages)) {
  process.stderr.write(`docs: warning: ${warning}\n`);
}
const examples = await checkExamples(pages, runReqseq);
const files = await assembleContent(paths);
process.stdout.write(
  `docs: ${String(examples)} example commands passed, ${String(files.length)} files in the content folder\n`,
);
