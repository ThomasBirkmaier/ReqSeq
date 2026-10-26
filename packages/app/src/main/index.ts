// Entry of the main process; everything it does is in startShell. Paths are those of the build
// (electron.vite.config.mjs): out/main/{index,core}.js, out/preload/index.cjs, out/renderer/.
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
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
  },
  log: (line) => process.stderr.write(`${line}\n`),
});
