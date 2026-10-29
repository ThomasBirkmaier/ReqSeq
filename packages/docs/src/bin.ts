import { fileURLToPath } from "node:url";
import { assembleContent, contentPaths } from "./assemble.js";

// `pnpm docs:generate`: fills packages/docs/site/src/content/docs/ before the site is built (ADR-0017).
const files = await assembleContent(contentPaths(fileURLToPath(new URL("../", import.meta.url))));
process.stdout.write(`docs: ${String(files.length)} files in the content folder\n`);
