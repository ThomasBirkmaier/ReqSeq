#!/usr/bin/env node
// Fails when a production dependency has a license outside the allowlist of ADR-0015.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/**
 * The problems of the production dependencies `byLicense` (the JSON of `pnpm --recursive licenses list --json --prod`;
 * since pnpm 12, `licenses list` in the workspace root covers only the root project without `--recursive`)
 * against the allowlist and the verified license files; empty when all are allowed.
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
      for (const [index, version] of p.versions.entries()) {
        const id = `${p.name}@${version}`;
        const entry = license === "Unknown" ? verified[id] : undefined;
        if (entry === undefined) {
          problems.push(`license not allowed (ADR-0015): ${id}: ${license}`);
          continue;
        }
        used.add(id);
        const file = path.join(p.paths[index] ?? p.paths[0] ?? "", entry.file);
        const actual = fs.existsSync(file) ? sha256(file) : "missing";
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
  const out = execFileSync("pnpm", ["--recursive", "licenses", "list", "--json", "--prod"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const byLicense = /No licenses in packages found/.test(out) ? {} : JSON.parse(out);
  const problems = licenseProblems(byLicense);
  if (problems.length) {
    for (const problem of problems) {
      console.error(`error: ${problem}`);
    }
    process.exit(1);
  }
  console.log(`licenses ok: ${Object.values(byLicense).flat().length} production packages`);
}
