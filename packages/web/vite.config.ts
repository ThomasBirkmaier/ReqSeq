// Build of the web UI (ADR-0020): one page, index.html, with its scripts, styles and fonts as files in dist/. No
// asset is inlined as a `data:` URL and no script or style is inline, so the page CSP (`script-src 'self'`,
// `font-src 'self'`) holds; every URL is relative, so the pages work under any address the UI server has.
import { defineConfig } from "vite";

// The @fontsource style sheets name each font as woff2 and woff. Every browser the UI supports takes the woff2, so
// the woff copies are dropped here and never emitted.
const FONTSOURCE_CSS = /[\\/]@fontsource[\\/][^\\/]+[\\/][^\\/]+\.css$/;
const WOFF_FALLBACK = /,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g;
const woff2Only = {
  name: "fontsource-woff2-only",
  enforce: "pre" as const,
  transform(code: string, id: string): { code: string; map: null } | undefined {
    return FONTSOURCE_CSS.test(id) ? { code: code.replace(WOFF_FALLBACK, ""), map: null } : undefined;
  },
};

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [woff2Only],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // The polyfill is not needed by the browsers the UI supports.
    modulePreload: { polyfill: false },
    target: "es2023",
  },
});
