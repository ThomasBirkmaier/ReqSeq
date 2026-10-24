// Resolve hook of worker-preload.mjs: a `.js` file of a package's sources that exists only as `.ts`
// (Vitest runs the sources, the build is not needed) resolves to the `.ts` file.
import { existsSync } from "node:fs";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const packages = new URL("../../packages/", import.meta.url).href;

/**
 * Whether `url` lies in the sources of a package. On Windows the case of a file URL may differ
 * (`file:///C:/` and `file:///c:/`), so it is compared without case there.
 */
export const inSources = (url, platform = process.platform) => {
  const fold = platform === "win32" ? (text) => text.toLowerCase() : (text) => text;
  return fold(url).startsWith(fold(packages)) && fold(url).includes("/src/");
};

/** The `.ts` source for a `.js` URL below `packages/*\/src/` that does not exist, else undefined. */
export const sourceFor = (url) => {
  if (!url.endsWith(".js") || !inSources(url)) {
    return undefined;
  }
  const ts = `${url.slice(0, -".js".length)}.ts`;
  return !existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(ts)) ? ts : undefined;
};

export const resolve = async (specifier, context, nextResolve) => {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!relative && !specifier.startsWith("file:")) {
    return nextResolve(specifier, context);
  }
  const url = relative ? new URL(specifier, context.parentURL).href : specifier;
  const source = sourceFor(url);
  return nextResolve(source ?? specifier, context);
};
