// Build of the web UI (ADR-0020): one page, index.html, with its scripts, styles and fonts as files in dist/. No
// asset is inlined as a `data:` URL and no script or style is inline, so the page CSP (`script-src 'self'`,
// `font-src 'self'`) holds; every URL is relative, so the pages work under any address the UI server has.
import { defineConfig } from "vite";

// The @fontsource and KaTeX style sheets name each font as woff2 and as woff (KaTeX also as ttf). Every browser the
// UI supports takes the woff2, so the other copies are dropped here and never emitted.
const FONT_CSS = /[\\/](?:@fontsource[\\/][^\\/]+|katex[\\/]dist)[\\/][^\\/]+\.css$/;
const WOFF_FALLBACK = /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g;
const woff2Only = {
  name: "woff2-only",
  enforce: "pre" as const,
  transform(code: string, id: string): { code: string; map: null } | undefined {
    return FONT_CSS.test(id) ? { code: code.replace(WOFF_FALLBACK, ""), map: null } : undefined;
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
