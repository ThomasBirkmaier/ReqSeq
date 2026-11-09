// The parts of staging the delivery that are pure or work on plain folders (ADR-0014, ThomasBirkmaier/ReqSeq-archive#324), tested in
// lib.test.mjs. scripts/package/stage.mjs runs them on the real build.
import fs from "node:fs/promises";
import path from "node:path";
import { licenseTexts } from "../licenses/policy.mjs";

/** Dependency fields of a package.json whose `@reqseq/*` entries point at workspace packages. */
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

/** Specs npm cannot install from a tarball or a plain folder. */
const LOCAL_SPEC = /^(?:workspace|link|file):/;

/**
 * The manifest of a staged package: `version` set, every dependency on a package of this workspace
 * (`scope`, e.g. `@reqseq/`) pinned to that version, development fields dropped. Throws when a
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

/** The version a release tag releases (ADR-0014): `v0.6` releases `0.6.0`; undefined for any other ref. */
export function versionOfTag(tag) {
  const m = /^v(\d+)\.(\d+)(?:\.(\d+))?$/.exec(tag);
  return m === null ? undefined : `${m[1]}.${m[2]}.${m[3] ?? "0"}`;
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

/**
 * The third-party notices of the staged folders: every package in their `node_modules` except the
 * workspace's own (`scope`), once per name and version, with its licence and licence texts, and the `extra`
 * entries `{ name, version, license, texts }` (the documentation site, scripts/licenses/site.mjs). `required`
 * names must be among them (ADR-0015: dagre and graphlib, bundled into the renderer).
 */
export async function noticesText({ nodeModules, scope, required, title, extra = [] }) {
  const packages = new Map(extra.map((e) => [`${e.name}@${e.version}`, e]));
  for (const root of nodeModules) {
    for (const folder of await packageFolders(root)) {
      const manifest = JSON.parse(await fs.readFile(path.join(folder, "package.json"), "utf8"));
      if (manifest.name.startsWith(scope)) {
        continue;
      }
      const key = `${manifest.name}@${manifest.version}`;
      if (!packages.has(key)) {
        const texts = licenseTexts(folder);
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
 * Build leftovers that must not ship (ThomasBirkmaier/ReqSeq-archive#324): source maps, type declarations and TypeScript build info. The
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

/** The sections of the release notes (#346), in order; a subject goes to the first section that matches it. */
const NOTE_SECTIONS = [
  { title: "New", test: /^(?:feat(?:\([^)]*\))?!?|SR-\d+):/ },
  { title: "Fixes", test: /^fix(?:\([^)]*\))?!?:/ },
  { title: "Specification", test: /^spec(?:\([^)]*\))?!?:/ },
];

/**
 * A commit subject as safe release-note text: `@name` in code style, so that it mentions nobody (e.g. a bump of
 * `@types/node`), and `<` escaped, so that it cannot open an HTML tag inside the folded section.
 */
const noteText = (subject) => subject.replaceAll(/(^|\s)(@[\w./-]+)/g, "$1`$2`").replaceAll("<", "&lt;");

/** The non-empty subjects by section of the release notes, in the order of NOTE_SECTIONS, then "Other changes". */
function noteGroups(subjects) {
  const groups = new Map([...NOTE_SECTIONS.map((s) => [s.title, []]), ["Other changes", []]]);
  for (const subject of subjects.map((s) => s.trim()).filter((s) => s !== "")) {
    const section = NOTE_SECTIONS.find((s) => s.test.test(subject));
    groups.get(section?.title ?? "Other changes").push(`- ${noteText(subject)}`);
  }
  return groups;
}

/**
 * The release notes of a tag (#346): the Conventional Commit subjects since the previous release tag (`previous`,
 * undefined for the first release), grouped into new functions, fixes, specification and other changes (enabler,
 * test, ci, docs, ...), all folded under "Technical changes", since the summary of the release (`releaseBody`) says
 * what changed for the user. `compareUrl` links the full difference.
 */
export function releaseNotes(subjects, { previous, compareUrl }) {
  const title = previous === undefined ? "Technical changes" : `Technical changes since ${previous}`;
  const lines = [`<details><summary>${title}</summary>`, ""];
  for (const [section, items] of noteGroups(subjects)) {
    if (items.length > 0) {
      lines.push(`### ${section}`, "", ...items, "");
    }
  }
  if (subjects.every((s) => s.trim() === "")) {
    lines.push("No changes.", "");
  }
  if (previous !== undefined) {
    lines.push(`Full list: ${compareUrl}`, "");
  }
  lines.push("</details>", "");
  return lines.join("\n");
}

/** The markers around the delivery part of a release body, so that `releaseBody` can write a body again. */
const DELIVERY_START = "<!-- delivery -->";
const DELIVERY_END = "<!-- /delivery -->";

/**
 * The delivery part of a release body: the download note and the files. A body that `releaseBody` wrote has it
 * between its markers; an older body has it before its "## Changes" list; other text (the delivery part the release
 * job composes) is all of it.
 */
export function deliveryOfBody(body) {
  const text = body.replaceAll("\r\n", "\n");
  const start = text.indexOf(DELIVERY_START);
  const end = text.indexOf(DELIVERY_END);
  if (start !== -1 && end > start) {
    return text.slice(start + DELIVERY_START.length, end).trim();
  }
  const changes = text.search(/^## Changes/m);
  return (changes === -1 ? text : text.slice(0, changes)).trim();
}

/**
 * The body of a GitHub release: the summary for the user (`docs/releases/<version>.md`), then the delivery part of
 * `body` (`deliveryOfBody`) between its markers, then the folded technical notes (`releaseNotes`). Writing a body
 * again from its own output gives the same body.
 */
export function releaseBody({ summary, body, notes }) {
  return [summary.trim(), "", DELIVERY_START, deliveryOfBody(body), DELIVERY_END, "", notes].join("\n");
}

/**
 * The page "What's new" of the documentation site (#1259): the release notes of each version, newest first, from
 * the same commit subjects and sections as `releaseNotes`, so that an offline installation has them too. `releases`
 * are `{ version, date, subjects }`, newest first; a `version` of undefined is the work since the last release. Only
 * new functions, fixes and the specification are listed: the other changes concern the development of ReqSeq. The
 * page names no web address, since an offline site cannot reach one. A release with a `summary` (the text of
 * `docs/releases/<version>.md`) shows that summary instead of its commit subjects.
 */
export function whatsNewPage(releases) {
  const lines = [
    "---",
    "title: What's new",
    "description: What changed for you in each version of ReqSeq, newest first.",
    "---",
    "",
    "What changed for you in each version, newest first. A version without a summary, and the work not released " +
      "yet, list their new functions, fixes and changes to the specification from the history of ReqSeq.",
    "",
  ];
  if (releases.length === 0) {
    lines.push("The history this documentation was built from holds no release.", "");
  }
  for (const { version, date, subjects, summary } of releases) {
    lines.push(version === undefined ? "## Not released yet" : `## ${version}`, "");
    if (date !== undefined) {
      lines.push(`Released ${date}.`, "");
    }
    if (summary !== undefined) {
      lines.push(summary.trim(), "");
      continue;
    }
    const groups = [...noteGroups(subjects)].filter(
      ([title, items]) => title !== "Other changes" && items.length > 0,
    );
    for (const [title, items] of groups) {
      lines.push(`### ${title}`, "", ...items, "");
    }
    if (groups.length === 0) {
      lines.push("No new functions, fixes or changes to the specification.", "");
    }
  }
  return lines.join("\n");
}

/**
 * The build info of a delivery (`tool info`, SR-161) from `git log -1 --format=%H%n%cI`: the commit and its
 * date, the build date, so a rebuild of the same commit gives the same file. Throws without a commit: a
 * delivery must not pass for a build from a checkout.
 */
export function buildInfoOf(gitLog) {
  const [commit = "", date = ""] = gitLog.trim().split(/\r?\n/);
  if (!/^[0-9a-f]{40}$/.test(commit) || Number.isNaN(Date.parse(date))) {
    throw new Error(`no commit to build from: ${JSON.stringify(gitLog)}`);
  }
  return { commit, date: new Date(date).toISOString() };
}

/**
 * Writes the build info into the core of a staged folder (`node_modules/@reqseq/core/dist/build-info.json`,
 * which core reads next to its code). The folder must be the staged one, not a link into packages/, so the
 * checkout's build stays without build info; an existing file is replaced, not written through.
 */
export async function writeBuildInfo(staged, info) {
  const dist = path.join(staged, "node_modules", "@reqseq", "core", "dist");
  const [real, inside] = await Promise.all([fs.realpath(dist), fs.realpath(staged)]);
  if (!real.startsWith(`${inside}${path.sep}`)) {
    throw new Error(`${dist} lies outside ${staged}: ${real}`);
  }
  const file = path.join(real, "build-info.json");
  await fs.rm(file, { force: true });
  await fs.writeFile(file, `${JSON.stringify(info, null, 2)}\n`);
  return file;
}

/**
 * Why the built site in `folder` is not the offline build that a delivery of `product` `version` ships (SR-141,
 * ADR-0017; empty: it is). Its `index.html` must have the title the site config gives every page
 * (`<page> | <product> <version>`), load its assets from base `/` (`/_astro/`), link to no social account (the
 * offline build leaves the repository link out) and have its search; the site must hold no symbolic link and no
 * source map.
 */
export async function offlineSiteProblems(folder, { product, version }) {
  const file = path.join(folder, "index.html");
  const index = await fs.readFile(file, "utf8").catch(() => undefined);
  if (index === undefined) {
    return [`no index.html in ${folder}: build the site with REQSEQ_DOCS_OFFLINE=1`];
  }
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  // The delivery holds plain files only: a link could point out of the site into the build machine.
  return [
    ...entries
      .filter((entry) => entry.isSymbolicLink())
      .map((entry) => `symbolic link in the site: ${path.join(entry.parentPath, entry.name)}`),
    ...entries
      .filter((entry) => !entry.isDirectory() && isBuildLeftover(entry.name))
      .map((entry) => `build leftover in the site: ${path.join(entry.parentPath, entry.name)}`),
    ...(/<title>[^<]*\| ([^<]*)<\/title>/.exec(index)?.[1] === `${product} ${version}`
      ? []
      : [`the title of ${file} does not end with "| ${product} ${version}"`]),
    ...(/(?:href|src)="\/_astro\//.test(index)
      ? []
      : [`${file} loads no asset from base /: not the offline build`]),
    ...(/class="[^"]*\bsocial-icons\b[^"]*"><a\b/.test(index)
      ? [`${file} links to a social account: not the offline build`]
      : []),
    ...(await searchProblems(folder, index)),
  ];
}

/**
 * Why the search of the site in `folder` cannot work offline (empty: it can): it needs `search-index.json` with at
 * least one page (packages/docs/src/search-index.ts) and a script of `_astro/` loaded by the start page `index`
 * that holds MiniSearch (site/src/components/Search.astro).
 */
async function searchProblems(folder, index) {
  const problems = [];
  const data = await fs
    .readFile(path.join(folder, "search-index.json"), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined);
  if (!(data?.index?.documentCount > 0)) {
    problems.push(`no search index with pages in ${path.join(folder, "search-index.json")}`);
  }
  const scripts = [...index.matchAll(/<script type="module" src="\/(_astro\/[\w.-]+\.js)">/g)].map(
    (m) => m[1],
  );
  const texts = await Promise.all(
    scripts.map((script) => fs.readFile(path.join(folder, ...script.split("/")), "utf8").catch(() => "")),
  );
  if (!texts.some((text) => text.includes("MiniSearch: "))) {
    problems.push(
      `${path.join(folder, "index.html")} loads no script with MiniSearch: the search is missing`,
    );
  }
  return problems;
}
