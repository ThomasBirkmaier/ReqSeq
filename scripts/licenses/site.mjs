#!/usr/bin/env node
// The licences of what the documentation site ships with a delivery (SR-141, ADR-0015). `licenses:check` reads only
// the workspace lockfile; the site has its own (packages/docs/site/pnpm-lock.yaml), and most of its about 290
// packages only build it. So the packages whose code or styles end up in the built site are named here, read from
// the site lockfile and its install, and checked against the allowlist of ADR-0015; the code that their prebuilt
// files bundle, which no lockfile shows, is pinned with its licence and a copy of its licence text in site-texts/.
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

/**
 * The packages of the site lockfile whose files the built site holds (`pnpm docs:build`, Linux x64). `textOf` names
 * the package whose licence file serves for one that ships none (Pagefind publishes its UI and binaries without).
 */
export const SITE_PACKAGES = [
  // The prefetch script and the inline scripts of every page.
  { name: "astro" },
  // Layout, styles, the scripts of search and table of contents, the code themes.
  { name: "@astrojs/starlight" },
  // The styles and the copy button of code blocks.
  { name: "astro-expressive-code" },
  { name: "@expressive-code/core" },
  { name: "@expressive-code/plugin-frames" },
  { name: "@expressive-code/plugin-shiki" },
  { name: "@expressive-code/plugin-text-markers" },
  // The search box, bundled into Starlight's search script.
  { name: "@pagefind/default-ui", textOf: "pagefind" },
  // pagefind.js, its worker and WebAssembly, the UI files of pagefind/, written by the binary of the build system.
  { name: "pagefind" },
  { name: "@pagefind/linux-x64", textOf: "pagefind" },
];

/**
 * Code inside the prebuilt files of SITE_PACKAGES, read by hand from the lockfiles of their sources and checked
 * against the published packages and crates. `inside` pins the versions it was read for: another version of
 * one of them in the site lockfile fails the check until this list is read again. The licence text is
 * `site-texts/<name>@<version>.txt`, copied from the published package.
 */
const PAGEFIND_UI = ["@pagefind/default-ui@1.5.2", "@pagefind/linux-x64@1.5.2"];
// The binary writes pagefind/ (its UI files and the WebAssembly).
const PAGEFIND_BINARY = ["@pagefind/linux-x64@1.5.2"];
const bundled = (name, version, license, inside) => ({ name, version, license, inside });
export const SITE_BUNDLED = [
  // Svelte and bcp-47 in the search box (pagefind_ui/default, package-lock.json of Pagefind 1.5.2).
  bundled("svelte", "4.2.20", "MIT", PAGEFIND_UI),
  bundled("bcp-47", "2.1.0", "MIT", PAGEFIND_UI),
  bundled("is-alphabetical", "2.0.1", "MIT", PAGEFIND_UI),
  bundled("is-alphanumerical", "2.0.1", "MIT", PAGEFIND_UI),
  bundled("is-decimal", "2.0.1", "MIT", PAGEFIND_UI),
  // pagefind-component-ui.js and pagefind-highlight.js.
  bundled("adequate-little-templates", "1.0.2", "MIT", PAGEFIND_BINARY),
  bundled("mark.js", "8.11.1", "MIT", PAGEFIND_BINARY),
  // The Rust crates compiled into wasm.*.pagefind: the normal (not build-only, not proc-macro) dependencies in
  // pagefind_web/Cargo.lock of Pagefind 1.5.2, whether or not the linker keeps code of them, and the standard
  // library of the compiler its producers section names (rustc 1.97.0-nightly, bf4fbfb7a 2026-04-11). Dual licences
  // are shipped under MIT.
  bundled("bit-set", "0.10.0", "Apache-2.0 OR MIT", PAGEFIND_BINARY),
  bundled("bit-vec", "0.9.1", "Apache-2.0 OR MIT", PAGEFIND_BINARY),
  bundled("cfg-if", "1.0.4", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  bundled("minicbor", "2.2.1", "BlueOak-1.0.0", PAGEFIND_BINARY),
  bundled("once_cell", "1.21.4", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  bundled("pagefind_microjson", "0.1.4", "GPL-3.0-only", PAGEFIND_BINARY),
  bundled("pagefind_stem", "1.0.0", "MIT AND BSD-3-Clause", PAGEFIND_BINARY),
  bundled("serde", "1.0.228", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  bundled("serde_core", "1.0.228", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  bundled("wasm-bindgen", "0.2.117", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  bundled("wasm-bindgen-shared", "0.2.117", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  bundled("write-json", "0.1.4", "MIT OR Apache-2.0", PAGEFIND_BINARY),
  // A dependency of wasm-bindgen-shared (its identifier checks); Unicode-3.0 is outside the allowlist (#1220).
  bundled("unicode-ident", "1.0.24", "(MIT OR Apache-2.0) AND Unicode-3.0", PAGEFIND_BINARY),
  bundled("rust-std", "1.97.0-nightly", "MIT OR Apache-2.0", PAGEFIND_BINARY),
];

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

/** The entries of the shipped packages of the lockfile (`versions`), their licence texts resolved; pushes problems. */
function packageEntries(packages, versions, readPackage, problems) {
  const entries = [];
  for (const { name, textOf } of packages) {
    const found = versions.get(name) ?? [];
    const manifest = found.length === 1 ? readPackage(name, found[0]) : undefined;
    if (found.length !== 1) {
      problems.push(`shipped package ${name} has ${String(found.length)} versions in the site lockfile`);
    } else if (manifest === undefined) {
      problems.push(`shipped package ${name}@${found[0]} is not installed: run pnpm docs:install`);
    } else {
      entries.push({ name, version: found[0], license: manifest.license, texts: manifest.texts, textOf });
    }
  }
  return entries.map(({ textOf, ...entry }) =>
    textOf === undefined ? entry : { ...entry, texts: entries.find((e) => e.name === textOf)?.texts ?? [] },
  );
}

/** The entries of the bundled code, with its licence text; pushes a problem for a host the lockfile lacks. */
function bundledEntries(bundled, versions, readText, problems) {
  return bundled.map(({ name, version, license, inside }) => {
    const stale = inside.filter((host) => {
      const at = host.lastIndexOf("@");
      return !(versions.get(host.slice(0, at)) ?? []).includes(host.slice(at + 1));
    });
    if (stale.length > 0) {
      problems.push(
        `bundled ${name}@${version} was read for ${stale.join(", ")}, which the site lockfile no longer has: read the bundled code again`,
      );
    }
    const text = readText(`${name}@${version}.txt`);
    return { name, version, license, texts: text === undefined ? [] : [text] };
  });
}

/**
 * The shipped packages with their licence and licence texts, and the problems: a package missing from the lockfile
 * or there in more than one version, an installed version that differs, a licence outside the allowlist, a
 * bundled entry whose host has another version, or a missing licence text. `readPackage(name, version)` gives
 * `{ license, texts }` of the installed package (texts: its licence files), `readText(file)` a file of site-texts/
 * or undefined. `packages` and `bundled` are SITE_PACKAGES and SITE_BUNDLED (tests give their own).
 */
export function siteLicenses({
  lockText,
  readPackage,
  readText,
  packages = SITE_PACKAGES,
  bundled = SITE_BUNDLED,
}) {
  const versions = lockVersions(lockText);
  const problems = [];
  const entries = [
    ...packageEntries(packages, versions, readPackage, problems),
    ...bundledEntries(bundled, versions, readText, problems),
  ];
  for (const entry of entries) {
    if (typeof entry.license !== "string" || !licenseAllowed(entry.license)) {
      problems.push(
        `license not allowed (ADR-0015): ${entry.name}@${entry.version}: ${String(entry.license)} (shipped in the documentation site)`,
      );
    } else if (entry.texts.length === 0) {
      problems.push(`no licence text for ${entry.name}@${entry.version} (shipped in the documentation site)`);
    }
  }
  return { entries, problems };
}

/**
 * The files the built site may hold, by path relative to it with `/`: its pages, the chunks and images of
 * `_astro/` (with the hidden source maps of the offline build), what Pagefind writes and the icons of public/. A file
 * outside them could be code no check has read.
 */
export const SITE_FILES = [
  /^(?:[a-z0-9-]+\/)*index\.html$/,
  /^404\.html$/,
  /^_astro\/[\w.-]+\.(?:js|js\.map|css|png|svg|jpg|jpeg|gif|webp|avif)$/,
  /^pagefind\/[\w./-]+$/,
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
 * virtual modules (`astro:scripts/page.js`), or undefined for any other source.
 */
export function sourcePackage(source) {
  const at = source.lastIndexOf("node_modules/");
  if (at >= 0) {
    const [first = "", second = ""] = source.slice(at + "node_modules/".length).split("/");
    return first.startsWith("@") ? `${first}/${second}` : first;
  }
  return /(?:^|\/)astro:[\w/.-]+$/.test(source) ? "astro" : undefined;
}

/**
 * Why the built site in `folder` (the offline build, with hidden source maps) may ship code that the licence check
 * has not read (empty: it does not): a file outside SITE_FILES, a script of `_astro/` without its source map (except
 * the copy button and a chunk that only imports others), and a source of a map whose package is not in `packages` (the names of SITE_PACKAGES).
 */
export function builtSiteProblems(folder, packages = SITE_PACKAGES.map((p) => p.name)) {
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

/** A reader of the licence texts in `folder`, undefined for a missing file. */
export const textReader = (folder) => (file) => {
  const full = path.join(folder, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : undefined;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const site = path.join(root, "packages", "docs", "site");
  const { entries, problems } = siteLicenses({
    lockText: fs.readFileSync(path.join(site, "pnpm-lock.yaml"), "utf8"),
    readPackage: pnpmPackageReader(path.join(site, "node_modules")),
    readText: textReader(path.join(here, "site-texts")),
  });
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  if (problems.length > 0) {
    process.exit(1);
  }
  console.log(`site licenses ok: ${String(entries.length)} shipped packages and bundled components`);
}
