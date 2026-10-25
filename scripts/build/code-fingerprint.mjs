// Writes `dist/code-fingerprint.json` after core's `tsc -b` (ADR-0008, SR-082): the fingerprint of
// the code that the model cache checks, computed once at build time, so that a packaged or bundled
// build (ADR-0014) needs no walk over its own files at start. It uses core's own function, so build
// and runtime agree. Usage: node scripts/build/code-fingerprint.mjs <dist folder>
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Writes the fingerprint file of the built core in `dist` and returns its path. */
export async function writeFingerprint(dist) {
  const cache = await import(pathToFileURL(path.resolve(dist, "model", "model-cache.js")).href);
  const file = path.resolve(dist, cache.FINGERPRINT_FILE);
  await fs.writeFile(file, cache.fingerprintFile(path.resolve(dist)));
  return file;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist] = process.argv.slice(2);
  if (dist === undefined) {
    console.error("usage: node scripts/build/code-fingerprint.mjs <dist folder>");
    process.exit(2);
  }
  await writeFingerprint(dist);
}
