// The parts of staging the delivery that are pure or work on plain folders (ADR-0014, #324), tested in
// lib.test.mjs. scripts/package/stage.mjs runs them on the real build.
import fs from "node:fs/promises";
import path from "node:path";

/** Dependency fields of a package.json whose `@logreq/*` entries point at workspace packages. */
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

/** Specs npm cannot install from a tarball or a plain folder. */
const LOCAL_SPEC = /^(?:workspace|link|file):/;

/**
 * The manifest of a staged package: `version` set, every dependency on a package of this workspace
 * (`scope`, e.g. `@logreq/`) pinned to that version, development fields dropped. Throws when a
 * `workspace:`, `link:` or `file:` spec is left, which `npm install` refuses (EUNSUPPORTEDPROTOCOL).
 */
export function stagedManifest(manifest, { version, scope, extra = {} }) {
  const { devDependencies: _dev, scripts: _scripts, ...rest } = manifest;
  const out = { ...rest, version, ...extra };
  for (const field of DEPENDENCY_FIELDS) {
    const deps = out[field];
    if (deps === undefined) {
      continue;
    }
    out[field] = Object.fromEntries(
      Object.entries(deps).map(([name, spec]) => [name, name.startsWith(scope) ? version : spec]),
    );
    for (const [name, spec] of Object.entries(out[field])) {
      if (LOCAL_SPEC.test(spec)) {
        throw new Error(`${manifest.name}: ${field}.${name} is still "${spec}"`);
      }
    }
  }
  return out;
}

/**
 * Whether `tag` releases `version` (ADR-0014): `v<version>`, or `v<major>.<minor>` when the patch is 0
 * (the stage tags `v0.<n>` on version `0.<n>.0`).
 */
export function tagReleasesVersion(tag, version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (m === null || !/^v\d+\.\d+(?:\.\d+)?$/.test(tag)) {
    return false;
  }
  return tag === `v${version}` || (m[3] === "0" && tag === `v${m[1]}.${m[2]}`);
}

/** A launcher template with the names of names.json filled in; Windows scripts get CRLF line ends. */
export function renderLauncher(template, names, { crlf = false } = {}) {
  const text = template.replaceAll("@PRODUCT@", names.productName);
  const lf = text.replaceAll("\r\n", "\n");
  return crlf ? lf.replaceAll("\n", "\r\n") : lf;
}

/** Throws for a symbolic link: a staged node_modules is flat and self-contained (a link would escape it). */
const refuseLink = (folder, entry) => {
  if (entry.isSymbolicLink()) {
    throw new Error(`symbolic link in a staged node_modules: ${path.join(folder, entry.name)}`);
  }
  return entry;
};

/**
 * The package folders in `nodeModules`, nested ones included (scoped packages one level down). Throws for a
 * symbolic link, so that no package escapes the checks of the staging.
 */
export async function packageFolders(nodeModules) {
  const found = [];
  const entries = await fs.readdir(nodeModules, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.map((e) => refuseLink(nodeModules, e))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const folder = path.join(nodeModules, entry.name);
    const folders = entry.name.startsWith("@")
      ? (await fs.readdir(folder, { withFileTypes: true }))
          .map((e) => refuseLink(folder, e))
          .filter((e) => e.isDirectory())
          .map((e) => path.join(folder, e.name))
      : [folder];
    for (const pkg of folders) {
      found.push(pkg, ...(await packageFolders(path.join(pkg, "node_modules"))));
    }
  }
  return found;
}

/** File names that hold a licence text, in the order they are preferred. */
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;

/**
 * The third-party notices of the staged folders: every package in their `node_modules` except the
 * workspace's own (`scope`), once per name and version, with its licence and licence texts. `required`
 * names must be among them (ADR-0015: dagre and graphlib, bundled into the renderer).
 */
export async function noticesText({ nodeModules, scope, required, title }) {
  const packages = new Map();
  for (const root of nodeModules) {
    for (const folder of await packageFolders(root)) {
      const manifest = JSON.parse(await fs.readFile(path.join(folder, "package.json"), "utf8"));
      if (manifest.name.startsWith(scope)) {
        continue;
      }
      const key = `${manifest.name}@${manifest.version}`;
      if (!packages.has(key)) {
        const files = (await fs.readdir(folder)).filter((f) => LICENSE_FILE.test(f)).sort();
        const texts = await Promise.all(files.map((f) => fs.readFile(path.join(folder, f), "utf8")));
        const { license } = manifest;
        packages.set(key, {
          name: manifest.name,
          version: manifest.version,
          // Old manifests give `{ type, url }`.
          license: typeof license === "object" && license !== null ? license.type : license,
          texts,
        });
      }
    }
  }
  const missing = required.filter((name) => ![...packages.values()].some((p) => p.name === name));
  if (missing.length > 0) {
    throw new Error(`third-party notices: ${missing.join(", ")} not found`);
  }
  const sections = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((p) =>
      [
        `${p.name} ${p.version}`,
        `License: ${p.license ?? "see below"}`,
        "",
        ...(p.texts.length > 0 ? p.texts.map((t) => t.trim()) : ["(the package has no licence file)"]),
      ]
        .join("\n")
        .trimEnd(),
    );
  return `${title}\n\n${sections.join(`\n\n${"-".repeat(72)}\n\n`)}\n`;
}

/**
 * Build leftovers that must not ship (#324): source maps, type declarations and TypeScript build info. The
 * testkit inspector (`packages/testkit/src/delivery.ts`, `isBuildLeftover`) finds the same in a delivery.
 */
export const isBuildLeftover = (file) => /\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/.test(file);

/** Removes the build leftovers below `folder`; gives how many. */
export async function removeBuildLeftovers(folder) {
  const files = (await fs.readdir(folder, { recursive: true })).filter(isBuildLeftover);
  await Promise.all(files.map((file) => fs.rm(path.join(folder, file))));
  return files.length;
}

/**
 * The hard-link entries of a `tar -tv` listing (lines that start with `h`). npm writes a file that is
 * hard-linked to another file of the package as such an entry, and `npm install` leaves those out.
 */
export const hardLinkEntries = (listing) => listing.split(/\r?\n/).filter((line) => line.startsWith("h"));
