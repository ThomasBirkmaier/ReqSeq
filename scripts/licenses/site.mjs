#!/usr/bin/env node
// The licences of what the documentation site ships with a delivery (SR-141, ADR-0015). `licenses:check` reads only
// the workspace lockfile; the site has its own (packages/docs/site/pnpm-lock.yaml), and most of its about 290
// packages only build it. So the packages whose code or styles end up in the built site are named here, read from
// the site lockfile and its install, and checked against the allowlist of ADR-0015; `builtSiteProblems` checks from
// the source maps of the offline build that no other package ships code.
//
//   node scripts/licenses/site.mjs   check (after `pnpm docs:install`); `stage.mjs --docs-site` runs the same check
//                                     and hands the notices to the staging
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { licenseAllowed, licenseTexts } from "./policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

/** The packages of the site lockfile whose files the built site holds (`pnpm docs:build`). */
export const SITE_PACKAGES = [
  // The prefetch script and the inline scripts of every page.
  { name: "astro" },
  // Layout, styles, the scripts of the table of contents, the theme and language selects, the code themes.
  { name: "@astrojs/starlight" },
  // The styles and the copy button of code blocks.
  { name: "astro-expressive-code" },
  { name: "@expressive-code/core" },
  { name: "@expressive-code/plugin-frames" },
  { name: "@expressive-code/plugin-shiki" },
  { name: "@expressive-code/plugin-text-markers" },
  // The search of the site (src/components/Search.astro).
  { name: "minisearch" },
];

/** The site's own sources in a source map (its components under src/), which need no licence of another. */
export const OWN_SOURCE = "(the site's own src/)";

/** The versions of each package of a pnpm lockfile (its `packages` keys, `name@version`). */
export function lockVersions(lockText) {
  const versions = new Map();
  for (const doc of YAML.parseAllDocuments(lockText).map((d) => d.toJS() ?? {})) {
    for (const key of Object.keys(doc.packages ?? {})) {
      const at = key.lastIndexOf("@");
      const name = key.slice(0, at);
      versions.set(name, [...(versions.get(name) ?? []), key.slice(at + 1)]);
    }
  }
  return versions;
}

/**
 * The shipped packages with their licence and licence texts, and the problems: a package missing from the lockfile
 * or there in more than one version, not installed in that version, with a licence outside the allowlist, or
 * without a licence text. `readPackage(name, version)` gives `{ license, texts }` of the installed package (texts:
 * its licence files), or undefined. `packages` is SITE_PACKAGES (tests give their own).
 */
export function siteLicenses({ lockText, readPackage, packages = SITE_PACKAGES }) {
  const versions = lockVersions(lockText);
  const problems = [];
  const entries = [];
  for (const { name } of packages) {
    const found = versions.get(name) ?? [];
    const manifest = found.length === 1 ? readPackage(name, found[0]) : undefined;
    if (found.length !== 1) {
      problems.push(`shipped package ${name} has ${String(found.length)} versions in the site lockfile`);
    } else if (manifest === undefined) {
      problems.push(`shipped package ${name}@${found[0]} is not installed: run pnpm docs:install`);
    } else if (typeof manifest.license !== "string" || !licenseAllowed(manifest.license)) {
      problems.push(
        `license not allowed (ADR-0015): ${name}@${found[0]}: ${String(manifest.license)} (shipped in the documentation site)`,
      );
    } else if (manifest.texts.length === 0) {
      problems.push(`no licence text for ${name}@${found[0]} (shipped in the documentation site)`);
    } else {
      entries.push({ name, version: found[0], license: manifest.license, texts: manifest.texts });
    }
  }
  return { entries, problems };
}

/**
 * The files the built site may hold, by path relative to it with `/`: its pages, the chunks and images of
 * `_astro/` (with the hidden source maps of the offline build), the search index, the plain-text documentation for
 * AI assistants (`llms.txt`, `llms-full.txt`) and the icons of public/. A file
 * outside them could be code no check has read.
 */
export const SITE_FILES = [
  /^(?:[a-z0-9-]+\/)*index\.html$/,
  /^404\.html$/,
  /^_astro\/[\w.-]+\.(?:js|js\.map|css|png|svg|jpg|jpeg|gif|webp|avif)$/,
  /^search-index\.json$/,
  /^llms(?:-full)?\.txt$/,
  /^(?:favicon\.ico|favicon\.svg|apple-touch-icon\.png)$/,
];

/**
 * The scripts without a source map: the copy button of code blocks, which astro-expressive-code writes as a file of
 * its own (`ec.<hash>.js`).
 */
const UNMAPPED_SCRIPT = /^_astro\/ec\.[\w-]+\.js$/;

/** A chunk that only imports other chunks of the site (Vite writes no map for it). */
const IMPORTS_ONLY = /^\s*(?:import\s*"\.\/[\w.-]+\.js";?\s*)+$/;

/**
 * The package of one `sources` entry of a source map: the name after its last `node_modules/`, `astro` for Astro's
 * virtual modules (`astro:scripts/page.js`), OWN_SOURCE for a file of the site's `src/` (a relative path that
 * leaves no `..` behind), or undefined for any other source.
 */
export function sourcePackage(source) {
  const at = source.lastIndexOf("node_modules/");
  if (at >= 0) {
    const [first = "", second = ""] = source.slice(at + "node_modules/".length).split("/");
    return first.startsWith("@") ? `${first}/${second}` : first;
  }
  if (/^(?:\.\.\/)*src\/(?:[\w-]+\/)*[\w.-]+(?:\?[\w&=.-]*)?$/.test(source)) {
    return OWN_SOURCE;
  }
  return /(?:^|\/)astro:[\w/.-]+$/.test(source) ? "astro" : undefined;
}

/**
 * Why the built site in `folder` (the offline build, with hidden source maps) may ship code that the licence check
 * has not read (empty: it does not): a file outside SITE_FILES, a script of `_astro/` without its source map (except
 * the copy button and a chunk that only imports others), and a source of a map whose package is not in `packages` (the
 * names of SITE_PACKAGES and the site's own sources).
 */
export function builtSiteProblems(folder, packages = [...SITE_PACKAGES.map((p) => p.name), OWN_SOURCE]) {
  const files = fs
    .readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
  const known = new Set(packages);
  const problems = files
    .filter((file) => !SITE_FILES.some((pattern) => pattern.test(file)))
    .map((file) => `file outside the shipped files of the site: ${file}`);
  for (const file of files.filter((f) => f.startsWith("_astro/") && f.endsWith(".js"))) {
    const onlyImports = () => IMPORTS_ONLY.test(fs.readFileSync(path.join(folder, file), "utf8"));
    if (!UNMAPPED_SCRIPT.test(file) && !files.includes(`${file}.map`) && !onlyImports()) {
      problems.push(`script without its source map (build with REQSEQ_DOCS_OFFLINE=1): ${file}`);
    }
  }
  for (const file of files.filter((f) => f.endsWith(".js.map"))) {
    const { sources = [] } = JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"));
    for (const source of new Set(sources)) {
      const name = sourcePackage(source);
      if (name === undefined || !known.has(name)) {
        problems.push(
          `${file} ships code of ${name ?? `an unknown source ${source}`}, which SITE_PACKAGES does not list`,
        );
      }
    }
  }
  return problems;
}

/** `{ license, texts }` of package `name` at `version` in a pnpm install (`node_modules/.pnpm`), or undefined. */
export function pnpmPackageReader(nodeModules) {
  const store = path.join(nodeModules, ".pnpm");
  const folders = fs.existsSync(store) ? fs.readdirSync(store) : [];
  return (name, version) => {
    const prefix = `${name.replace("/", "+")}@${version}`;
    const folder = folders.find(
      (f) => f === prefix || f.startsWith(`${prefix}_`) || f.startsWith(`${prefix}(`),
    );
    if (folder === undefined) {
      return undefined;
    }
    const dir = path.join(store, folder, "node_modules", ...name.split("/"));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (manifest.version !== version) {
      return undefined;
    }
    const texts = licenseTexts(dir);
    return { license: manifest.license, texts };
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const site = path.join(root, "packages", "docs", "site");
  const { entries, problems } = siteLicenses({
    lockText: fs.readFileSync(path.join(site, "pnpm-lock.yaml"), "utf8"),
    readPackage: pnpmPackageReader(path.join(site, "node_modules")),
  });
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  if (problems.length > 0) {
    process.exit(1);
  }
  console.log(`site licenses ok: ${String(entries.length)} shipped packages`);
}
