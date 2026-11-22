#!/usr/bin/env node
// Stages the delivery without Electron (ADR-0020, #2308): one archive per system with the launcher bin/<launcher>,
// the pinned Node in runtime/ (toolchain/packaging/node.json, without npm), the command line with the MCP server and
// the UI server in lib/ (a flat production node_modules), the pages of the web UI in lib/web/, the documentation site
// in lib/docs/ (SR-141), the example of connecting a test tool and the third-party notices (ADR-0015); and the CLI
// tarball. Run after `pnpm build` and `--docs-site`, with the Node archives of `--node-urls` in $REQSEQ_NODE_ARCHIVES.
//
//   node scripts/package/stage.mjs               stage into build/package/ and write the archives into delivery/
//   node scripts/package/stage.mjs --node-urls   print the address and file name of each pinned Node archive, one
//                                                 pair per line, for the download of the release workflow
//   node scripts/package/stage.mjs --docs-site   check the offline build of the site (packages/docs/site/dist)
//                                                 and the licences of what it ships, and put it with its
//                                                 notices into $REQSEQ_DOCS_SITE (default build/docs-site/)
//   node scripts/package/stage.mjs --pack        npm pack the staged CLI into delivery/ (the CLI tarball)
//   node scripts/package/stage.mjs --check-tag T exit 0 when tag T releases the root version, else 1
//   node scripts/package/stage.mjs --release-body R F  print the GitHub release text of ref R (a release tag, or
//                                                 a commit of the root version): the summary docs/releases/<version>.md,
//                                                 the delivery part of the text in file F and the first-parent
//                                                 commits since the previous release tag (#346), folded
//   node scripts/package/stage.mjs --whats-new F  write the page "What's new" of the documentation site to F
//                                                 (#1259): the release notes of every release before HEAD
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DELIVERY_SYSTEMS,
  buildInfoOf,
  deliveryArtifactName,
  deliveryFolderName,
  hardLinkEntries,
  nodeArchiveMembers,
  nodeArchiveUrl,
  nodeNotice,
  nodePinProblems,
  noticesText,
  offlineSiteProblems,
  packageFolders,
  releaseBody,
  releaseNotes,
  removeBuildLeftovers,
  renderLauncher,
  sha256Of,
  stagedManifest,
  tagReleasesVersion,
  versionOfTag,
  whatsNewPage,
  writeBuildInfo,
} from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const packaging = path.join(root, "toolchain", "packaging");
const out = path.join(root, "build", "package");
const delivery = path.join(root, "delivery");
/** The offline documentation site and its notices (`--docs-site`; the release job `docs-site` hands it over). */
const docsSite = process.env.REQSEQ_DOCS_SITE ?? path.join(root, "build", "docs-site");
/** Where the Node archives of node.json lie (the release workflow downloads them once and caches them). */
const nodeArchives = process.env.REQSEQ_NODE_ARCHIVES ?? path.join(root, "build", "node-archives");
/** ADR-0020: the web UI bundles KaTeX and the IBM Plex fonts, so the notices must name them. */
const REQUIRED_NOTICES = ["katex", "@fontsource/ibm-plex-sans", "@fontsource/ibm-plex-mono"];

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const names = await readJson(path.join(packaging, "names.json"));
const { version } = await readJson(path.join(root, "package.json"));
const SCOPE = names.packageScope;

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    // Progress to stderr: stdout carries only the results.
    stdio: ["ignore", 2, 2],
    shell: process.platform === "win32",
    ...options,
  });

/**
 * pnpm deploy of one workspace package into `dest`, flat (hoisted), production dependencies only. Third-party
 * files are copied, not hard-linked from pnpm's store: npm pack writes a file hard-linked to another file of
 * the package as a link entry, and npm install leaves link entries out. The workspace packages that pnpm
 * injects may still be hard links of their build in packages/: pinVersions replaces their manifests instead
 * of writing through them, and pack() refuses a tarball with link entries.
 */
async function deploy(pkg, dest) {
  await fs.rm(dest, { recursive: true, force: true });
  run("pnpm", [
    "--filter",
    `${SCOPE}${pkg}`,
    "deploy",
    "--prod",
    "--legacy",
    "--config.node-linker=hoisted",
    "--config.package-import-method=copy",
    dest,
  ]);
  await fs.rm(path.join(dest, "node_modules", ".bin"), { recursive: true, force: true });
}

/** Pins the workspace packages of a staged folder to the root version (the folder and its node_modules). */
async function pinVersions(folder, extra = {}) {
  const manifests = [
    path.join(folder, "package.json"),
    ...(await packageFolders(path.join(folder, "node_modules")))
      .filter((p) =>
        path.relative(path.join(folder, "node_modules"), p).split(path.sep).join("/").startsWith(SCOPE),
      )
      .map((p) => path.join(p, "package.json")),
  ];
  for (const [index, file] of manifests.entries()) {
    const manifest = stagedManifest(await readJson(file), {
      version,
      scope: SCOPE,
      extra: index === 0 ? extra : {},
    });
    // The injected workspace packages may be hard links of packages/: replace the file, never write through it.
    await fs.rm(file);
    await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/** The site and its notices from `--docs-site`; throws when they are missing or not the offline build. */
async function readDocsSite() {
  const site = path.join(docsSite, "site");
  const problems = await offlineSiteProblems(site, { product: names.productName, version });
  if (problems.length > 0) {
    throw new Error(`documentation site in ${docsSite}: ${problems.join("; ")} (run --docs-site first)`);
  }
  return { site, notices: await readJson(path.join(docsSite, "notices.json")) };
}

/**
 * `--docs-site`: the offline build of the site (`REQSEQ_DOCS_OFFLINE=1`), checked that it ships only files and code
 * the licence check reads (`builtSiteProblems`, from its hidden source maps) and the licences of that code
 * (scripts/licenses/site.mjs), copied without the source maps and with its notices into `docsSite`, where it must
 * then be the offline build of this version.
 */
async function docsSiteStage() {
  // Loaded here only: site.mjs needs `yaml`, and the release job runs `--check-tag` and `--release-body` without an
  // install (stage.test.mjs keeps the module graph of stage.mjs free of packages).
  const { builtSiteProblems, pnpmPackageReader, siteLicenses } = await import("../licenses/site.mjs");
  const sitePackage = path.join(root, "packages", "docs", "site");
  const dist = path.join(sitePackage, "dist");
  const licenses = siteLicenses({
    lockText: await fs.readFile(path.join(sitePackage, "pnpm-lock.yaml"), "utf8"),
    readPackage: pnpmPackageReader(path.join(sitePackage, "node_modules")),
  });
  const problems = [...builtSiteProblems(dist), ...licenses.problems];
  if (problems.length > 0) {
    throw new Error(`documentation site:\n${problems.join("\n")}`);
  }
  await fs.rm(docsSite, { recursive: true, force: true });
  await fs.cp(dist, path.join(docsSite, "site"), {
    recursive: true,
    filter: (file) => !file.endsWith(".map"),
  });
  await fs.writeFile(path.join(docsSite, "notices.json"), `${JSON.stringify(licenses.entries, null, 2)}\n`);
  await readDocsSite();
  console.log(docsSite);
}

async function stage() {
  const docs = await readDocsSite();
  const pin = await readNodePin();
  const cli = path.join(out, "cli");
  await fs.rm(out, { recursive: true, force: true });
  await deploy("cli", cli);
  // The documentation of this version (SR-141): `docs/` of the CLI, which `reqseq serve docs` serves; lib/docs/ in the
  // archives, package/docs/ in the CLI tarball.
  await fs.rm(path.join(cli, "docs"), { recursive: true, force: true });
  await fs.cp(docs.site, path.join(cli, "docs"), { recursive: true });
  // The pages of the web UI (ADR-0020), which `reqseq ui` serves from `web/` next to the CLI's dist/: lib/web/ in the
  // archives, package/web/ in the CLI tarball.
  const pages = path.join(root, "packages", "web", "dist");
  await fs.access(path.join(pages, "index.html")).catch(() => {
    throw new Error(`no built web UI in ${pages} (run pnpm build first)`);
  });
  await fs.cp(pages, path.join(cli, "web"), { recursive: true });
  // No source maps, type declarations or build info in the delivery or the CLI tarball (the inspector checks).
  await removeBuildLeftovers(cli);
  // The CLI tarball carries its dependencies, so it installs without network (SR-078 AK2).
  await pinVersions(cli, { bundleDependencies: true });
  // The commit and its date, which `tool info` shows in every access of the delivery (SR-161).
  const build = buildInfoOf(
    execFileSync("git", ["log", "-1", "--format=%H%n%cI"], { cwd: root, encoding: "utf8" }),
  );
  await writeBuildInfo(cli, build);

  // The packages the web UI bundles are its production dependencies; they are staged only for their notices.
  const web = path.join(out, "web-dependencies");
  await deploy("web", web);
  // What the HTML export copies into its folder (SR-231 AK5): the Mermaid bundle and KaTeX's styles, which core ships
  // in `vendor/html-export/` (scripts/licenses/html-export.mjs).
  const { VENDOR_NOTICES } = await import(
    pathToFileURL(path.join(root, "packages", "core", "dist", "html-export", "notices.generated.js")).href
  );
  const notices = (title, extra) =>
    noticesText({
      nodeModules: [path.join(cli, "node_modules"), path.join(web, "node_modules")],
      scope: SCOPE,
      required: [...REQUIRED_NOTICES, ...extra.map((e) => e.name)],
      title,
      extra: [...docs.notices, ...VENDOR_NOTICES, ...extra],
    });
  // The CLI tarball runs on the user's Node: its own notices, of the command line, the web UI and the documentation.
  await fs.writeFile(
    path.join(cli, "THIRD_PARTY_NOTICES.txt"),
    await notices(
      `Third-party software in the ${names.productName} ${version} command line (CLI, MCP server, web UI and documentation)`,
      [],
    ),
  );

  await fs.rm(delivery, { recursive: true, force: true });
  await fs.mkdir(delivery, { recursive: true });
  const runtimes = path.join(out, "node");
  for (const system of Object.keys(DELIVERY_SYSTEMS)) {
    const node = await nodeRuntime(pin, system, path.join(runtimes, system));
    const folder = deliveryFolderName(names, system, version);
    const dest = path.join(out, folder);
    await fs.cp(cli, path.join(dest, "lib"), { recursive: true });
    // The archive has one notices file, at its top.
    await fs.rm(path.join(dest, "lib", "THIRD_PARTY_NOTICES.txt"));
    await fs.mkdir(path.join(dest, "runtime"));
    await fs.copyFile(node.binary, path.join(dest, "runtime", DELIVERY_SYSTEMS[system].node));
    await fs.chmod(path.join(dest, "runtime", DELIVERY_SYSTEMS[system].node), 0o755);
    await fs.mkdir(path.join(dest, "bin"));
    const launcher = path.join(dest, "bin", DELIVERY_SYSTEMS[system].launcher(names.launcher));
    if (system === "win") {
      const cmd = await fs.readFile(path.join(packaging, "launchers", "launcher.cmd"), "utf8");
      await fs.writeFile(launcher, renderLauncher(cmd, names, { crlf: true }));
    } else {
      const sh = await fs.readFile(path.join(packaging, "launchers", "launcher.sh"), "utf8");
      await fs.writeFile(launcher, renderLauncher(sh, names), { mode: 0o755 });
    }
    // The example of connecting a test tool (SR-063), which the documentation names.
    await fs.cp(path.join(root, "toolchain", "junit"), path.join(dest, "examples", "junit"), {
      recursive: true,
      filter: (file) => !/(?:^|[\\/])(?:__pycache__|\.pytest_cache)(?:[\\/]|$)/.test(file),
    });
    await fs.writeFile(
      path.join(dest, "THIRD_PARTY_NOTICES.txt"),
      await notices(
        `Third-party software in ${names.productName} ${version} (command line, MCP server, web UI, documentation and Node runtime)`,
        [nodeNotice(pin.version, node.license)],
      ),
    );
    const artifact = path.join(delivery, deliveryArtifactName(names, system, version));
    // zip keeps the executable bits; the folder is the archive's only entry at the top.
    if (DELIVERY_SYSTEMS[system].ext === "zip") {
      run("zip", ["-q", "-r", "-X", artifact, folder], { cwd: out });
    } else {
      run("tar", ["--owner=0", "--group=0", "--numeric-owner", "-czf", artifact, "-C", out, folder]);
    }
    console.log(artifact);
  }
}

/** toolchain/packaging/node.json, checked (`nodePinProblems`). */
async function readNodePin() {
  const pin = await readJson(path.join(packaging, "node.json"));
  const problems = nodePinProblems(pin, await fs.readFile(path.join(root, ".nvmrc"), "utf8"));
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
  return pin;
}

/**
 * The Node binary and licence of `system` from its archive in `nodeArchives`, checked against the SHA-256 of the
 * pin and unpacked into `dest`. Nothing is downloaded here: the release workflow fetches the archives (`--node-urls`).
 */
async function nodeRuntime(pin, system, dest) {
  const archive = path.join(nodeArchives, pin.archives[system].file);
  const sum = await sha256Of(archive).catch((error) => {
    throw new Error(`no Node archive ${archive} (download the files of --node-urls first)`, { cause: error });
  });
  if (sum !== pin.archives[system].sha256) {
    throw new Error(`${archive}: SHA-256 ${sum}, but node.json pins ${pin.archives[system].sha256}`);
  }
  const members = nodeArchiveMembers(pin, system);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  const listed = [members.binary, members.license];
  if (archive.endsWith(".zip")) {
    run("unzip", ["-q", archive, ...listed, "-d", dest]);
  } else {
    run("tar", ["-xzf", archive, "-C", dest, ...listed]);
  }
  return {
    binary: path.join(dest, members.binary),
    license: await fs.readFile(path.join(dest, members.license), "utf8"),
  };
}

async function pack() {
  await fs.mkdir(delivery, { recursive: true });
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", delivery], {
    cwd: path.join(out, "cli"),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const [{ filename }] = JSON.parse(output);
  const target = path.join(delivery, names.cliTarball.replace("${version}", version));
  if (path.join(delivery, filename) !== target) {
    await fs.rename(path.join(delivery, filename), target);
  }
  const links = hardLinkEntries(execFileSync("tar", ["-tvzf", target], { encoding: "utf8" }));
  if (links.length > 0) {
    await fs.rm(target);
    throw new Error(
      `the CLI tarball has hard-link entries, which npm install leaves out:\n${links.join("\n")}`,
    );
  }
  console.log(target);
}

/** The release notes of `ref` (#346), from the git history; the repository must have its tags. */
function notes(ref) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  let previous;
  try {
    // Release tags only: `v<major>.<minor>` or `v<major>.<minor>.<patch>`, no `-rc` tags.
    previous = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--exclude", "*-*", `${ref}^`);
  } catch {
    previous = undefined;
  }
  const range = previous === undefined ? ref : `${previous}..${ref}`;
  const subjects = git("log", "--first-parent", "--format=%s", range).split("\n");
  const repo = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "ThomasBirkmaier/ReqSeq"}`;
  return releaseNotes(subjects, { previous, compareUrl: `${repo}/compare/${previous}...${ref}` });
}

/**
 * The summary for the user of the release of `version` (`docs/releases/<version>.md`), written with the version PR;
 * undefined when there is none.
 */
async function summaryOf(version) {
  try {
    return await fs.readFile(path.join(root, "docs", "releases", `${version}.md`), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * `--release-body`: the text of the GitHub release of `ref` (`releaseBody`), with the delivery part of the text in
 * `file`. A release tag names its version; any other ref is a commit of the root version (a manual run). Throws
 * without the summary of that version, so that a manual run before the tag shows it missing.
 */
async function releaseBodyOf(ref, file) {
  const released = versionOfTag(ref) ?? version;
  const summary = await summaryOf(released);
  if (summary === undefined) {
    throw new Error(
      `no summary of version ${released}: write docs/releases/${released}.md (the merge skill says how)`,
    );
  }
  return releaseBody({ summary, body: await fs.readFile(file, "utf8"), notes: notes(ref) });
}

/**
 * The releases for the page "What's new" (#1259), newest first by version: each release tag reachable from HEAD
 * with the first-parent commits since the tag before and its summary (`summaryOf`), and the commits since the last one
 * when HEAD is no release.
 * A shallow clone lacks tags or history: the page then names no release or too few commits, which
 * `REQSEQ_DOCS_RELEASES=1` (the builds that are published, `.github/actions/docs-site`) refuses.
 */
async function releasesForWhatsNew() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  const lines = (text) => text.split("\n").filter((line) => line !== "");
  const subjects = (range) => git("log", "--first-parent", "--format=%s", range).split("\n");
  // Release tags only, as `notes`: `v<major>.<minor>` or `v<major>.<minor>.<patch>`, no `-rc` tags.
  const tags = lines(git("tag", "--list", "v[0-9]*", "--merged", "HEAD", "--sort=-v:refname")).filter(
    (tag) => !tag.includes("-"),
  );
  if (
    process.env.REQSEQ_DOCS_RELEASES === "1" &&
    (tags.length === 0 || git("rev-parse", "--is-shallow-repository") === "true")
  ) {
    throw new Error("no release tag or a shallow history: check out the whole history with its tags");
  }
  const releases = await Promise.all(
    tags.map(async (tag, index) => ({
      version: tag.slice(1),
      date: git("for-each-ref", "--format=%(creatordate:short)", `refs/tags/${tag}`),
      subjects: subjects(index + 1 < tags.length ? `${tags[index + 1]}..${tag}` : tag),
      summary: await summaryOf(versionOfTag(tag)),
    })),
  );
  const head = git("rev-parse", "HEAD");
  if (tags.length > 0 && git("rev-parse", `${tags[0]}^{commit}`) !== head) {
    releases.unshift({ version: undefined, date: undefined, subjects: subjects(`${tags[0]}..HEAD`) });
  }
  return releases;
}

const [mode, argument] = process.argv.slice(2);
if (mode === undefined) {
  await stage();
} else if (mode === "--node-urls") {
  const pin = await readNodePin();
  for (const system of Object.keys(DELIVERY_SYSTEMS)) {
    console.log(`${nodeArchiveUrl(pin, system)} ${pin.archives[system].file}`);
  }
} else if (mode === "--docs-site") {
  await docsSiteStage();
} else if (mode === "--pack") {
  await pack();
} else if (mode === "--check-tag" && argument !== undefined) {
  const ok = tagReleasesVersion(argument, version);
  console.log(ok ? `${argument} releases ${version}` : `${argument} does not release version ${version}`);
  process.exitCode = ok ? 0 : 1;
} else if (mode === "--release-body" && argument !== undefined && process.argv[4] !== undefined) {
  process.stdout.write(await releaseBodyOf(argument, process.argv[4]));
} else if (mode === "--whats-new" && argument !== undefined) {
  await fs.writeFile(argument, whatsNewPage(await releasesForWhatsNew()));
} else {
  console.error(
    "usage: node scripts/package/stage.mjs [--node-urls | --docs-site | --pack | --check-tag <tag> | --release-body <ref> <file> | --whats-new <file>]",
  );
  process.exitCode = 2;
}
