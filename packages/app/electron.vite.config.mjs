// Build of the app (ADR-0010): main process and core process (ES modules, @reqseq/core stays an
// external package), the sandboxed preload (CommonJS, everything bundled) and the renderer (React).
// Output in out/, loaded by Electron from package.json "main".
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const here = import.meta.dirname;

// KaTeX's style sheet (SR-096) names each font as woff2, woff and ttf. Chromium takes the woff2, so the
// other two are dropped here and never emitted; the `app:` handler serves only woff2 fonts anyway.
const KATEX_CSS = /[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/;
const OLD_FONT = /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g;
const katexWoff2Only = {
  name: "katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    return KATEX_CSS.test(id) ? { code: code.replace(OLD_FONT, ""), map: null } : undefined;
  },
};

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
    plugins: [katexWoff2Only],
    build: {
      outDir: resolve(here, "out/renderer"),
      // A font is never inlined as a `data:` URL: the CSP has no `font-src`, so `default-src 'self'` would
      // block it (KaTeX_Size3 is below Vite's 4 KB limit). Fonts are files served by `app:`.
      assetsInlineLimit: (file) => (/\.(?:woff2?|ttf|otf)$/i.test(file) ? false : undefined),
      rolldownOptions: { input: resolve(here, "src/renderer/index.html") },
    },
  },
});
