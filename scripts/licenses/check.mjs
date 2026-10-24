#!/usr/bin/env node
// Fails when a production dependency has a license outside the allowlist of ADR-0015.
import { execFileSync } from "node:child_process";

const ALLOWED = new Set([
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

const out = execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (/No licenses in packages found/.test(out)) {
  console.log("licenses ok: no production dependencies");
  process.exit(0);
}
const byLicense = JSON.parse(out);
const bad = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  // SPDX expressions like "(MIT OR Apache-2.0)": ok when one alternative is allowed.
  const options = license.replace(/[()]/g, "").split(/\s+OR\s+/);
  if (!options.some((l) => ALLOWED.has(l.trim()))) {
    bad.push(...pkgs.map((p) => `${p.name}@${p.versions.join(",")}: ${license}`));
  }
}
if (bad.length) {
  for (const b of bad) {
    console.error(`error: license not allowed (ADR-0015): ${b}`);
  }
  process.exit(1);
}
console.log(`licenses ok: ${Object.values(byLicense).flat().length} production packages`);
