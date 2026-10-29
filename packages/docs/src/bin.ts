import { fileURLToPath } from "node:url";
import { getCommandRuntime } from "@reqseq/core";
import { assembleContent, contentPaths } from "./assemble.js";
import { commandReference, readGeneratedContracts } from "./reference.js";

// `pnpm docs:generate`: fills packages/docs/site/src/content/docs/ before the site is built (ADR-0017). The base
// path must be the one the site is built with (packages/docs/site/astro.config.mjs, same variable and default).
const paths = contentPaths(fileURLToPath(new URL("../", import.meta.url)));
const base = process.env["REQSEQ_DOCS_BASE"] ?? "/ReqSeq";
const pages = await commandReference(getCommandRuntime(), await readGeneratedContracts(paths.repoRoot), base);
const files = await assembleContent(paths, pages);
process.stdout.write(`docs: ${String(files.length)} files in the content folder\n`);
