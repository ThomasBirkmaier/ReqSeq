// Build of the app (ADR-0010): main process and core process (ES modules, @logreq/core stays an
// external package), the sandboxed preload (CommonJS, everything bundled) and the renderer (React).
// Output in out/, loaded by Electron from package.json "main".
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const here = import.meta.dirname;

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rolldownOptions: {
        input: {
          index: resolve(here, "src/main/index.ts"),
          core: resolve(here, "src/core/main.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      // A sandboxed preload can load no module of its own: one CommonJS file.
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve(here, "src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(here, "src/renderer"),
    build: {
      outDir: resolve(here, "out/renderer"),
      rolldownOptions: { input: resolve(here, "src/renderer/index.html") },
    },
  },
});
