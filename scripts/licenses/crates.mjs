#!/usr/bin/env node
// Fails when a crate the desktop shell ships has a licence outside the allowlist of ADR-0015 (ADR-0021, Crates and
// licences). The crates are those linked into `reqseq-shell` or `ReqSeq` on one of the three release targets, as
// `cargo tree --edges normal,no-proc-macro` lists them with the features Cargo resolves for that target: no build
// dependencies and no proc macros, which run only on the build machine (as check.mjs reads only the production
// packages of npm). Old SPDX spellings with `/` count as `OR`. With `--notices` it writes the notice entries of the
// crates of one target, with the licence files of each crate (the Unicode-3.0 text of the ICU4X crates among them),
// which `scripts/package/stage.mjs` puts into the notices of that system's archive (ADR-0015, #2379).
//
//   node scripts/licenses/crates.mjs                          after `cargo fetch --locked` in packages/shell
//   node scripts/licenses/crates.mjs --notices <target> <file>  write the notice entries of <target> as JSON
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { licenseAllowed, licenseTexts } from "./policy.mjs";

/** The standard MIT text, for a crate under MIT that ships no licence file of its own. */
const MIT_TEXT = path.join(path.dirname(fileURLToPath(import.meta.url)), "texts", "spdx-MIT.txt");

/** The release targets of the shell (ADR-0020, Release: one archive per system). */
export const TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin", "x86_64-pc-windows-msvc"];

/** The format of each line of `cargo tree` that `parseTree` reads. */
export const TREE_FORMAT = "{p}|{l}";

/** `MIT/Apache-2.0` and `Apache-2.0 / MIT`, as older crates write them, in SPDX: `MIT OR Apache-2.0`. */
export const spdxOf = (license) => license.replace(/\s*\/\s*/g, " OR ");

/**
 * The crates of the output of `cargo tree --prefix none -f '{p}|{l}'`, each once as `{ name, version, license }`;
 * the workspace's own crates (a path source) are left out.
 */
export function parseTree(text) {
  const crates = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+) v(\S+)( \([^)]*\))?(?: \(\*\))?\|(.*?)(?: \(\*\))?$/.exec(line);
    if (m === null || (m[3] ?? "").startsWith(" (/") || /^ \([A-Za-z]:/.test(m[3] ?? "")) {
      continue;
    }
    const license = m[4] === "" ? null : m[4];
    crates.set(`${m[1]}@${m[2]}`, { name: m[1], version: m[2], license });
  }
  return [...crates.values()];
}

/** The crates whose licence the allowlist does not allow, as `name@version: licence`, sorted and without repeats. */
export function crateProblems(crates) {
  const problems = new Set();
  for (const crate of crates) {
    if (crate.license === null || !licenseAllowed(spdxOf(crate.license))) {
      problems.add(`${crate.name}@${crate.version}: ${crate.license ?? "no licence in its manifest"}`);
    }
  }
  return [...problems].sort();
}

/** Whether an SPDX expression offers MIT as one of its choices (`MIT`, or `MIT` on a side of a top-level `OR`). */
export const offersMit = (license) =>
  spdxOf(license)
    .split(/\s+OR\s+/)
    .includes("MIT");

/**
 * The notice entries `{ name, version, license, texts }` of `crates` (`parseTree`), sorted, and the problems:
 * `packageOf(key)` gives the `{ folder, authors }` of a crate `name@version` (from `cargo metadata`), and the texts
 * are its licence files. A crate without one, under a licence that offers MIT, gets the standard MIT text `mit` with
 * a line that says so and names its authors; any other crate without one is a problem.
 */
export function crateNotices(crates, packageOf, mit) {
  const entries = new Map();
  const problems = [];
  for (const crate of crates) {
    const key = `${crate.name}@${crate.version}`;
    const pkg = packageOf(key);
    if (entries.has(key) || pkg === undefined) {
      if (pkg === undefined) {
        problems.push(`${key}: not in cargo metadata`);
      }
      continue;
    }
    const license = spdxOf(crate.license ?? "");
    let texts = licenseTexts(pkg.folder).map((text) => text.trim());
    if (texts.length === 0 && offersMit(license)) {
      const by = pkg.authors.length > 0 ? ` by ${pkg.authors.join(", ")}` : "";
      texts = [
        `The crate ships no licence file; its manifest names ${license}${by}. The MIT text:\n\n${mit.trim()}`,
      ];
    }
    if (texts.length === 0) {
      problems.push(`${key}: no licence file, and its licence ${license || "(none)"} offers no MIT text`);
      continue;
    }
    entries.set(key, { name: crate.name, version: crate.version, license, texts });
  }
  const sorted = [...entries.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  return { entries: sorted, problems: [...new Set(problems)].sort() };
}

const MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "shell",
  "Cargo.toml",
);

/** The crates `cargo tree` gives for `target` (no build dependencies, no proc macros). */
const treeOf = (target) =>
  parseTree(
    execFileSync(
      "cargo",
      [
        "tree",
        "--locked",
        "--offline",
        "--manifest-path",
        MANIFEST,
        "--workspace",
        "--edges",
        "normal,no-proc-macro",
        "--target",
        target,
        "--prefix",
        "none",
        "--format",
        TREE_FORMAT,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );

/** `--notices`: the notice entries of the crates of `target`, as JSON in `file`. */
function writeNotices(target, file) {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--locked",
        "--offline",
        "--manifest-path",
        MANIFEST,
        "--filter-platform",
        target,
      ],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    ),
  );
  const packages = new Map(
    metadata.packages.map((p) => [
      `${p.name}@${p.version}`,
      { folder: path.dirname(p.manifest_path), authors: p.authors ?? [] },
    ]),
  );
  const crates = treeOf(target);
  const { entries, problems } = crateNotices(
    crates,
    (key) => packages.get(key),
    fs.readFileSync(MIT_TEXT, "utf8"),
  );
  const all = [...crateProblems(crates), ...problems];
  if (all.length > 0) {
    console.error(`Crates of the desktop shell for ${target}:\n${all.join("\n")}`);
    process.exit(1);
  }
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(
    `${String(entries.length)} crates of the desktop shell for ${target}, with their licence texts.`,
  );
}

function main() {
  const [mode, target, file] = process.argv.slice(2);
  if (mode === "--notices") {
    if (!TARGETS.includes(target) || file === undefined) {
      console.error(`usage: node scripts/licenses/crates.mjs --notices <${TARGETS.join(" | ")}> <file>`);
      process.exit(2);
    }
    writeNotices(target, file);
    return;
  }
  const crates = TARGETS.flatMap(treeOf);
  const problems = crateProblems(crates);
  if (problems.length > 0) {
    console.error(
      `Crates of the desktop shell with a licence outside the allowlist (ADR-0015):\n${problems.join("\n")}`,
    );
    process.exit(1);
  }
  const count = new Set(crates.map((c) => `${c.name}@${c.version}`)).size;
  console.log(`${String(count)} crates of the desktop shell, each with an allowed licence.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
