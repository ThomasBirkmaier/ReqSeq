#!/usr/bin/env node
// Fails when a crate the desktop shell ships has a licence outside the allowlist of ADR-0015 (ADR-0021, Crates and
// licences). The crates are those linked into `reqseq-shell` or `ReqSeq` on one of the three release targets, as
// `cargo tree --edges normal,no-proc-macro` lists them with the features Cargo resolves for that target: no build
// dependencies and no proc macros, which run only on the build machine (as check.mjs reads only the production
// packages of npm). Old SPDX spellings with `/` count as `OR`.
//
//   node scripts/licenses/crates.mjs            after `cargo fetch --locked` in packages/shell
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { licenseAllowed } from "./policy.mjs";

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

function main() {
  const manifest = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "packages",
    "shell",
    "Cargo.toml",
  );
  const crates = TARGETS.flatMap((target) =>
    parseTree(
      execFileSync(
        "cargo",
        [
          "tree",
          "--locked",
          "--offline",
          "--manifest-path",
          manifest,
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
    ),
  );
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
