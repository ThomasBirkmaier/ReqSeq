import { fileURLToPath } from "node:url";
import { getCommandRuntime } from "@reqseq/core";
import { assembleContent, contentPaths } from "./assemble.js";
import { checkExamples, readGuidePages, runReqseq, wordWarnings } from "./examples.js";
import { commandReference, readGeneratedContracts } from "./reference.js";

// `pnpm docs:generate`: runs the examples of the guide (SR-140 AK2), warns on pages above the word budget, and
// fills packages/docs/site/src/content/docs/ before the site is built (ADR-0017). A failing example rejects, so
// the process ends with a non-zero exit code and the build stops. The base path must be the one the site is
// built with (packages/docs/site/astro.config.mjs, same variable and default).
const paths = contentPaths(fileURLToPath(new URL("../", import.meta.url)));
const base = process.env["REQSEQ_DOCS_BASE"] ?? "/ReqSeq";
const guide = await readGuidePages(paths.guideDir);
for (const warning of wordWarnings(guide)) {
  process.stderr.write(`docs: warning: ${warning}\n`);
}
const examples = await checkExamples(guide, runReqseq);
const pages = await commandReference(getCommandRuntime(), await readGeneratedContracts(paths.repoRoot), base);
const files = await assembleContent(paths, pages, base);
process.stdout.write(
  `docs: ${String(examples)} example commands passed, ${String(files.length)} files in the content folder\n`,
);
