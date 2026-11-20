// Writes the vendor files of the HTML export (SR-231 AK5; packages/core/docs/html-export.md) into
// `packages/core/vendor/html-export/`, which git ignores and core's `files` ships:
//
// - `mermaid.js`: Mermaid bundled by us from its ESM against the lockfile into one minified classic script that sets
//   the global `mermaid`, with a hidden source map for the licence check (`scripts/licenses/html-export.mjs`), which
//   core's `files` leaves out. Mermaid's own `dist/mermaid.min.js` bundles an older KaTeX, DOMPurify and marked out of
//   reach of the lockfile and `pnpm audit`. A script with `eval`, `new Function` or a dynamic `import` fails the build:
//   the pages' policy allows neither, and an export holds one file.
// - `katex.css`: KaTeX's stylesheet with its woff2 fonts as `data:` URLs and the woff and ttf entries removed, since
//   Firefox treats every `file://` file as an origin of its own and refuses fonts from another file.
//
// Core's `build` runs it, and core's tests through `scripts/test-support/html-export-vendor.mjs` when a file is missing.
//   node scripts/build/html-export-vendor.mjs
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = path.join(here, "..", "..", "packages", "core");
/** The folder the export reads its vendor files from (`html-export/vendor.ts`). */
export const VENDOR = path.join(core, "vendor", "html-export");
export const VENDOR_FILES = ["mermaid.js", "katex.css"];

/** What in a bundled script the pages could not run or would load from elsewhere (empty: nothing). */
export function scriptProblems(code) {
  const found = [];
  for (const [what, pattern] of [
    ["eval", /\beval\s*\(/u],
    ["new Function", /\bnew\s+Function\b/u],
    ["a dynamic import", /\bimport\s*\(/u],
  ]) {
    if (pattern.test(code)) {
      found.push(what);
    }
  }
  return found;
}

/** KaTeX's stylesheet `css` with each woff2 font as a `data:` URL (`read(name)` gives its bytes) and no other format. */
export async function inlineFonts(css, read) {
  const names = [...new Set([...css.matchAll(/url\(fonts\/([\w-]+\.woff2)\)/gu)].map((m) => m[1]))];
  const fonts = new Map(
    await Promise.all(names.map(async (name) => [name, Buffer.from(await read(name)).toString("base64")])),
  );
  const out = css
    .replaceAll(/,url\(fonts\/[\w-]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/gu, "")
    .replaceAll(
      /url\(fonts\/([\w-]+\.woff2)\)/gu,
      (_, name) => `url(data:font/woff2;base64,${String(fonts.get(name))})`,
    );
  if (/url\((?!data:font\/woff2;base64,)/u.test(out)) {
    throw new Error("katex.css: a url() is left that is no inlined woff2 font");
  }
  return out;
}

/** Bundles Mermaid and writes both vendor files into `folder`. */
export async function writeVendor(folder = VENDOR) {
  const require = createRequire(path.join(core, "package.json"));
  const { rolldown } = await import(pathToFileURL(require.resolve("rolldown")).href);
  await fs.mkdir(folder, { recursive: true });
  // The entry lies in core, so that `mermaid` resolves from core's dependencies.
  const entry = path.join(folder, ".entry.mjs");
  await fs.writeFile(entry, 'export { default } from "mermaid";\n');
  try {
    const bundle = await rolldown({ input: entry, platform: "browser", cwd: core, logLevel: "warn" });
    const { output } = await bundle.generate({
      file: path.join(folder, "mermaid.js"),
      format: "iife",
      name: "mermaid",
      exports: "default",
      minify: true,
      sourcemap: "hidden",
      codeSplitting: false,
    });
    await bundle.close();
    const [chunk] = output.filter((o) => o.type === "chunk");
    const problems = scriptProblems(chunk.code);
    if (problems.length > 0) {
      throw new Error(
        `mermaid.js holds ${problems.join(", ")}, which the pages of the HTML export cannot run`,
      );
    }
    await fs.writeFile(path.join(folder, "mermaid.js"), chunk.code);
    await fs.writeFile(path.join(folder, "mermaid.js.map"), JSON.stringify(chunk.map));
  } finally {
    await fs.rm(entry, { force: true });
  }
  const katex = path.dirname(require.resolve("katex/package.json"));
  const css = await fs.readFile(path.join(katex, "dist", "katex.min.css"), "utf8");
  await fs.writeFile(
    path.join(folder, "katex.css"),
    await inlineFonts(css, (name) => fs.readFile(path.join(katex, "dist", "fonts", name))),
  );
  return folder;
}

/** Whether every vendor file is in `folder`. */
export async function vendorComplete(folder = VENDOR) {
  const found = await Promise.all(
    VENDOR_FILES.map((name) =>
      fs.stat(path.join(folder, name)).then(
        (s) => s.isFile(),
        () => false,
      ),
    ),
  );
  return found.every(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const folder = await writeVendor();
  console.log(`html export vendor files written to ${path.relative(process.cwd(), folder)}`);
}
