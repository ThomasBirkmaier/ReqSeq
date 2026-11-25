import { fileURLToPath } from "node:url";
import { exportTheme } from "./export-theme.js";

// `pnpm docs:export-theme [--check]`: the look of the docs for the HTML export (export-theme.ts), from the offline
// build in packages/docs/site/dist.
const at = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const result = await exportTheme(
  {
    site: at("../site/dist"),
    packages: [
      at("../site/node_modules/@astrojs/starlight"),
      at("../site/node_modules/@fontsource/ibm-plex-mono"),
      at("../site/node_modules/@fontsource/ibm-plex-sans"),
    ],
    module: at("../../core/src/html-export/docs-theme.generated.ts"),
  },
  process.argv.includes("--check"),
);
process.stdout.write(result.message);
process.exitCode = result.ok ? 0 : 1;
