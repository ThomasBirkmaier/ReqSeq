import { fileURLToPath } from "node:url";
import { writeDiagrams } from "./diagrams.js";

// `pnpm docs:diagrams`: writes the architecture pictures of docs/architecture/ from the repository's sources.
const written = await writeDiagrams(fileURLToPath(new URL("../../../", import.meta.url)));
process.stdout.write(`docs: wrote ${written.join(", ")}\n`);
