#!/usr/bin/env node
// The licences of what the HTML export copies into its folder (SR-231 AK5, ADR-0015): the Mermaid bundle
// (`assets/mermaid.js`, scripts/build/html-export-vendor.mjs) and KaTeX's styles and fonts (`assets/katex.css`).
// Mermaid and the packages it bundles are dev dependencies of core, so `licenses:check` and `pnpm deploy` do not see
// them as shipped. This script reads the bundle's hidden source map: a source below `node_modules/.pnpm/<name>@<version>/`
// is that installed package; a source inside one of `@mermaid-js/parser`'s own prebuilt chunks is followed through
// that chunk's map, which names what the parser bundles but does not install (langium, chevrotain and their parts):
// their licence texts are kept in `texts/` with their SHA-256 (`texts/bundled.json`). A source it cannot attribute,
// a licence outside the allowlist or a text without its hash fails it. It writes the tool-written
// `packages/core/src/html-export/notices.generated.ts`, which the export writes as `licenses/THIRD-PARTY-NOTICES.txt`
// (with Starlight's, from the docs theme), and `stage.mjs` adds the entries to the notices of the CLI and the delivery.
//
//   node scripts/licenses/html-export.mjs           write the notices module
//   node scripts/licenses/html-export.mjs --check   fail when it differs (`pnpm licenses:check`)
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERIFIED_LICENSE_FILES } from "./check.mjs";
import { licenseAllowed, licenseTexts } from "./policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
export const MODULE = path.join(root, "packages", "core", "src", "html-export", "notices.generated.ts");
const TEXTS = path.join(here, "texts");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** `{ name, version, folder }` of a source path below `node_modules/.pnpm/<store folder>/node_modules/<name>/`. */
export function storePackage(source) {
  const match = /node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(source);
  if (match === null) {
    return undefined;
  }
  const [, store = "", name = ""] = match;
  const prefix = `${name.replace("/", "+")}@`;
  if (!store.startsWith(prefix)) {
    return undefined;
  }
  const version = store.slice(prefix.length).split(/[_(]/u)[0];
  return { name, version, folder: source.slice(0, match.index + match[0].length - 1) };
}

/**
 * The package of a source in a prebuilt chunk of `@mermaid-js/parser`: a store path, the parser's own `src/`, or the
 * webpack bundle of vscode-uri that langium bundles (`webpack://LIB/`; its `node_modules/` is path-browserify).
 */
export function parserSource(source, parser) {
  const stored = storePackage(source);
  if (stored !== undefined) {
    return { name: stored.name, version: stored.version };
  }
  if (/^(?:\.\.\/)+src\//u.test(source)) {
    return parser;
  }
  if (source.startsWith("webpack://LIB/node_modules/path-browserify/")) {
    return { name: "path-browserify", version: "1.0.1" };
  }
  if (/^webpack:\/\/LIB\/(?:src|webpack)\//u.test(source)) {
    return { name: "vscode-uri", version: "3.1.0" };
  }
  return undefined;
}

/**
 * The packages whose code the bundle with the source map `map` (at `mapFile`) holds, by `name@version`: installed
 * ones with their folder, bundled ones without. `readMap(file)` reads a map of a parser chunk. Unknown sources go
 * into `problems`.
 */
export function bundledPackages(map, mapFile, readMap) {
  const packages = new Map();
  const problems = [];
  const add = (entry) =>
    packages.set(`${entry.name}@${entry.version}`, {
      ...packages.get(`${entry.name}@${entry.version}`),
      ...entry,
    });
  for (const source of new Set(map.sources)) {
    if (source.endsWith("/.entry.mjs") || source === ".entry.mjs") {
      continue;
    }
    const absolute = path.resolve(path.dirname(mapFile), source).split(path.sep).join("/");
    const stored = storePackage(absolute);
    if (stored === undefined) {
      problems.push(`the Mermaid bundle holds code of an unknown source: ${source}`);
      continue;
    }
    add(stored);
    if (stored.name === "@mermaid-js/parser" && /\/dist\/chunks\//u.test(absolute)) {
      const chunk = readMap(`${absolute}.map`);
      for (const inner of new Set(chunk?.sources ?? [])) {
        const found = parserSource(inner, { name: stored.name, version: stored.version });
        if (found === undefined) {
          problems.push(`a chunk of @mermaid-js/parser holds code of an unknown source: ${inner}`);
        } else if (found.name !== stored.name) {
          add(found);
        }
      }
    }
  }
  return { packages: [...packages.values()], problems };
}

/** The notice entries `{ name, version, license, texts }` of `packages`, and the problems. */
export function noticeEntries(packages, bundled) {
  const problems = [];
  const entries = [];
  const byKey = new Map(bundled.map((b) => [`${b.name}@${b.version}`, b]));
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    let license;
    let texts;
    if (pkg.folder !== undefined && fs.existsSync(path.join(pkg.folder, "package.json"))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(pkg.folder, "package.json"), "utf8"));
      texts = licenseTexts(pkg.folder);
      // A manifest without `license` whose file was checked by hand (`licenses:check`, VERIFIED_LICENSE_FILES).
      const verified = VERIFIED_LICENSE_FILES[key];
      const file = verified === undefined ? undefined : path.join(pkg.folder, verified.file);
      license =
        manifest.license === undefined &&
        file !== undefined &&
        fs.existsSync(file) &&
        sha256(fs.readFileSync(file)) === verified.sha256
          ? verified.license
          : manifest.license;
    } else {
      const kept = byKey.get(key);
      if (kept === undefined) {
        problems.push(`${key} is bundled but neither installed nor in scripts/licenses/texts/bundled.json`);
        continue;
      }
      const text = fs.readFileSync(path.join(TEXTS, kept.file), "utf8");
      if (sha256(text) !== kept.sha256) {
        problems.push(`the licence text ${kept.file} does not have the SHA-256 bundled.json names`);
        continue;
      }
      license = kept.license;
      texts = [text];
    }
    if (typeof license !== "string" || !licenseAllowed(license)) {
      problems.push(`license not allowed (ADR-0015): ${key}: ${String(license)} (copied by the HTML export)`);
    } else {
      // A package without a licence file is named with its licence, as the delivery's notices do.
      entries.push({ name: pkg.name, version: pkg.version, license, texts: texts.map((t) => t.trim()) });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { entries, problems };
}

/** The TypeScript module of `entries`. */
export function noticesModule(entries) {
  return [
    "// Written by `node scripts/licenses/html-export.mjs` from the Mermaid bundle and KaTeX; do not edit. The notices",
    "// of what the HTML export copies into its folder (SR-231, ADR-0015).",
    `export const VENDOR_NOTICES: readonly { readonly name: string; readonly version: string; readonly license: string; readonly texts: readonly string[] }[] = ${JSON.stringify(entries)};`,
    "",
  ].join("\n");
}

/** The entries and problems of the vendor folder `vendor` (Mermaid's map) and the KaTeX install `katex`. */
export function htmlExportNotices({ vendor, katex }) {
  const mapFile = path.join(vendor, "mermaid.js.map");
  const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  const readMap = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined);
  const { packages, problems } = bundledPackages(map, mapFile, readMap);
  const katexManifest = JSON.parse(fs.readFileSync(path.join(katex, "package.json"), "utf8"));
  const withKatex = packages.some((p) => p.name === "katex" && p.version === katexManifest.version)
    ? packages
    : [...packages, { name: "katex", version: katexManifest.version, folder: katex }];
  const bundled = JSON.parse(fs.readFileSync(path.join(TEXTS, "bundled.json"), "utf8"));
  const notices = noticeEntries(withKatex, bundled);
  return { entries: notices.entries, problems: [...problems, ...notices.problems] };
}

/** The paths of this checkout, after the vendor files are built. */
export async function checkoutNotices() {
  const { createRequire } = await import("node:module");
  const { vendorComplete, writeVendor, VENDOR } = await import("../build/html-export-vendor.mjs");
  if (!(await vendorComplete()) || !fs.existsSync(path.join(VENDOR, "mermaid.js.map"))) {
    await writeVendor();
  }
  const require = createRequire(path.join(root, "packages", "core", "package.json"));
  return htmlExportNotices({ vendor: VENDOR, katex: path.dirname(require.resolve("katex/package.json")) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { entries, problems } = await checkoutNotices();
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  if (problems.length > 0) {
    process.exit(1);
  }
  const module = noticesModule(entries);
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(MODULE) ? fs.readFileSync(MODULE, "utf8") : "";
    if (current !== module) {
      console.error(
        "error: packages/core/src/html-export/notices.generated.ts differs from the Mermaid bundle; run node scripts/licenses/html-export.mjs",
      );
      process.exit(1);
    }
    console.log(`html export licenses ok: ${String(entries.length)} copied packages`);
  } else {
    fs.writeFileSync(MODULE, module);
    console.log(`html export notices written: ${String(entries.length)} packages`);
  }
}
