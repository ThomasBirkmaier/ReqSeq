#!/usr/bin/env node
// Fails when a production dependency has a license outside the allowlist of ADR-0015.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

export const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "MPL-2.0",
]);

/**
 * Packages whose `package.json` names no license, so pnpm reports "Unknown", while the license file they
 * ship is one of the allowlist (ADR-0015). Each is pinned by exact name and version and by the sha256 of
 * that file as it was read and checked by hand: another version, another text or a missing file fails
 * again, and an entry no installed package uses fails too (no stale exceptions). This is no ignore: the
 * license is read from the package itself, only from its file instead of its manifest.
 *
 * - khroma 2.1.0 (Mermaid, SR-096 diagrams): `license` is the standard MIT text (2019-present Fabio
 *   Spampinato, Andrew Maney); its `package.json` has no `license` field.
 */
export const VERIFIED_LICENSE_FILES = {
  "khroma@2.1.0": {
    license: "MIT",
    file: "license",
    sha256: "66b333b0f66759a0b710459e03f7029abe17f4358114a128d2c972e642961b49",
  },
};

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Drops the peer suffix of a lockfile version: `6.0.0(vite@8.3.5)` is `6.0.0`. */
const withoutPeers = (version) => version.replace(/\(.*$/, "");

/**
 * The production packages of `pnpm-lock.yaml` (`lockText`) as `name@version`: the `dependencies` and
 * `optionalDependencies` of every workspace project and, transitively, of every package they reach (snapshots).
 * `platform` holds those that are installed only on some systems (`os`, `cpu` or `libc` in the lockfile).
 * Since pnpm 11 the lockfile has several YAML documents (the pnpm version first); all of them are read.
 */
export function productionClosure(lockText) {
  const ids = new Set();
  const platform = new Set();
  const seen = new Set();
  for (const doc of YAML.parseAllDocuments(lockText).map((d) => d.toJS() ?? {})) {
    const snapshots = doc.snapshots ?? {};
    const packages = doc.packages ?? {};
    const queue = [];
    const add = (name, version) => {
      if (/^(link|file):/.test(version)) {
        return; // a workspace project: its own dependencies are an importer of their own
      }
      // An alias (`string-width-cjs: string-width@4.2.3`) names the real package in its version.
      const alias = /^(@?[^@(\d][^@(]*)@(.+)$/.exec(version);
      const key = alias ? version : `${name}@${version}`;
      const id = alias ? `${alias[1]}@${withoutPeers(alias[2])}` : `${name}@${withoutPeers(version)}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      ids.add(id);
      const manifest = packages[id] ?? {};
      if (manifest.os || manifest.cpu || manifest.libc) {
        platform.add(id);
      }
      queue.push(key);
    };
    for (const importer of Object.values(doc.importers ?? {})) {
      for (const field of ["dependencies", "optionalDependencies"]) {
        for (const [name, dep] of Object.entries(importer?.[field] ?? {})) {
          add(name, dep.version);
        }
      }
    }
    while (queue.length) {
      const snapshot = snapshots[queue.pop()] ?? {};
      for (const field of ["dependencies", "optionalDependencies"]) {
        for (const [name, version] of Object.entries(snapshot[field] ?? {})) {
          add(name, version);
        }
      }
    }
  }
  return { ids, platform };
}

/**
 * The part of `byLicense` (the JSON of `pnpm --recursive licenses list --json`, all installed packages) that is in
 * the production `closure`, and a problem for each production package the listing lacks (unless it is installed
 * only on other systems). pnpm 12's `licenses list --prod` leaves out optional dependencies of dependencies, so
 * the listing is taken without `--prod` and cut to the closure of the lockfile here. Since pnpm 12,
 * `licenses list` in the workspace root covers only the root project without `--recursive`.
 */
export function productionListing(byLicense, closure) {
  const listed = new Set();
  const result = {};
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const p of pkgs) {
      const versions = p.versions.filter((v) => closure.ids.has(`${p.name}@${v}`));
      versions.forEach((v) => listed.add(`${p.name}@${v}`));
      if (versions.length) {
        (result[license] ??= []).push({ ...p, versions });
      }
    }
  }
  const problems = [...closure.ids]
    .filter((id) => !listed.has(id) && !closure.platform.has(id))
    .map((id) => `production package ${id} of pnpm-lock.yaml is missing from pnpm licenses list`);
  return { byLicense: result, problems };
}

/**
 * The folder of `version` of `p` among `p.paths`, which pnpm 12 does not keep in the order of `p.versions` (it
 * lists every installed copy): the one in pnpm's virtual store folder `name@version`. Only when no path is in a
 * store folder of the package at all (another layout), the only path of a package with one version; else
 * undefined.
 */
export function packagePath(p, version) {
  const prefix = `${p.name.replace("/", "+")}@`;
  const folder = `${prefix}${version}`;
  const parts = (candidate) => candidate.split(/[\\/]/);
  const found = p.paths.find((candidate) =>
    parts(candidate).some(
      (part) => part === folder || part.startsWith(`${folder}_`) || part.startsWith(`${folder}(`),
    ),
  );
  const inStore = p.paths.some((candidate) => parts(candidate).some((part) => part.startsWith(prefix)));
  return found ?? (!inStore && p.versions.length === 1 && p.paths.length === 1 ? p.paths[0] : undefined);
}

/**
 * The problems of the production dependencies `byLicense` (see `productionListing`) against the allowlist and
 * the verified license files; empty when all are allowed.
 */
export function licenseProblems(byLicense, verified = VERIFIED_LICENSE_FILES) {
  const problems = [];
  const used = new Set();
  for (const [license, pkgs] of Object.entries(byLicense)) {
    // SPDX expressions like "(MIT OR Apache-2.0)": ok when one alternative is allowed.
    const options = license.replace(/[()]/g, "").split(/\s+OR\s+/);
    if (options.some((l) => ALLOWED.has(l.trim()))) {
      continue;
    }
    for (const p of pkgs) {
      for (const version of p.versions) {
        const id = `${p.name}@${version}`;
        const entry = license === "Unknown" ? verified[id] : undefined;
        if (entry === undefined) {
          problems.push(`license not allowed (ADR-0015): ${id}: ${license}`);
          continue;
        }
        used.add(id);
        const folder = packagePath(p, version);
        const file = folder === undefined ? undefined : path.join(folder, entry.file);
        const actual = file !== undefined && fs.existsSync(file) ? sha256(file) : "missing";
        if (actual !== entry.sha256 || !ALLOWED.has(entry.license)) {
          problems.push(
            `license file of ${id} is not the verified ${entry.license} text (ADR-0015): ${entry.file} sha256 ${actual}`,
          );
        }
      }
    }
  }
  for (const id of Object.keys(verified)) {
    if (!used.has(id)) {
      problems.push(`verified license file of ${id} is not used by any production package: remove the entry`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = execFileSync("pnpm", ["--recursive", "licenses", "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const all = /No licenses in packages found/.test(out) ? {} : JSON.parse(out);
  const closure = productionClosure(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "pnpm-lock.yaml"),
      "utf8",
    ),
  );
  const listing = productionListing(all, closure);
  const problems = [...listing.problems, ...licenseProblems(listing.byLicense)];
  if (problems.length) {
    for (const problem of problems) {
      console.error(`error: ${problem}`);
    }
    process.exit(1);
  }
  const pkgs = Object.values(listing.byLicense).flat();
  const versions = pkgs.reduce((n, p) => n + p.versions.length, 0);
  console.log(`licenses ok: ${pkgs.length} production packages, ${versions} versions`);
}
