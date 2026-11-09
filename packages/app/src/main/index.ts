// Entry of the main process; everything it does is in startShell. Paths are those of the build
// (electron.vite.config.mjs): out/main/{index,core}.js, out/preload/index.cjs, out/renderer/; the documentation
// is that of the delivery (`docs.ts`).
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { docsFolder } from "./docs.js";
import { startShell } from "./shell.js";

const here = path.dirname(fileURLToPath(import.meta.url));

void startShell(electron, {
  argv: process.argv,
  cwd: process.cwd(),
  platform: process.platform,
  paths: {
    preload: path.join(here, "..", "preload", "index.cjs"),
    renderer: path.join(here, "..", "renderer"),
    core: path.join(here, "core.js"),
    docs: docsFolder({
      packaged: electron.app.isPackaged,
      resources: process.resourcesPath,
      app: path.join(here, "..", ".."),
      argv: process.argv,
      cwd: process.cwd(),
    }),
  },
  log: (line) => process.stderr.write(`${line}\n`),
});
