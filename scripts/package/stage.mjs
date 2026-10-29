#!/usr/bin/env node
// Stages the delivery for electron-builder (ADR-0014, #324): two self-contained folders with a flat
// production node_modules (the app and the CLI with the MCP server), the launchers rendered from
// toolchain/packaging/names.json and the third-party notices (ADR-0015). Run after `pnpm build` and
// electron-vite's build of the app (`build:electron`).
//
//   node scripts/package/stage.mjs               stage into build/package/, print the environment for
//                                                 electron-builder (and append it to $GITHUB_ENV in Actions)
//   node scripts/package/stage.mjs --pack        npm pack the staged CLI into delivery/ (the CLI tarball)
//   node scripts/package/stage.mjs --check-tag T exit 0 when tag T releases the root version, else 1
//   node scripts/package/stage.mjs --release-notes R  print the release notes of ref R (a tag or HEAD): the
//                                                 first-parent commits since the previous release tag (#346)
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  hardLinkEntries,
  noticesText,
  packageFolders,
  releaseNotes,
  removeBuildLeftovers,
  renderLauncher,
  stagedManifest,
  tagReleasesVersion,
} from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const packaging = path.join(root, "toolchain", "packaging");
const out = path.join(root, "build", "package");
const delivery = path.join(root, "delivery");
/** ADR-0015 (SR-111): the renderer bundles them, so the notices must name them. */
const REQUIRED_NOTICES = ["@dagrejs/dagre", "@dagrejs/graphlib"];

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const names = await readJson(path.join(packaging, "names.json"));
const { version } = await readJson(path.join(root, "package.json"));
const SCOPE = names.packageScope;

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    // Progress to stderr: stdout carries only the environment for electron-builder.
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

async function stage() {
  const app = path.join(out, "app");
  const cli = path.join(out, "cli");
  const launchers = path.join(out, "launchers");
  await deploy("cli", cli);
  await deploy("app", app);
  // electron-vite's output is git-ignored, so deploy does not copy it.
  await fs.cp(path.join(root, "packages", "app", "out"), path.join(app, "out"), { recursive: true });
  // No source maps, type declarations or build info in the delivery or the CLI tarball (the inspector checks).
  await removeBuildLeftovers(cli);
  await removeBuildLeftovers(app);
  // The CLI tarball carries its dependencies, so it installs without network (SR-078 AK2).
  await pinVersions(cli, { bundleDependencies: true });
  await pinVersions(app, { productName: names.productName });

  await fs.mkdir(launchers, { recursive: true });
  const sh = await fs.readFile(path.join(packaging, "launchers", "launcher.sh"), "utf8");
  const cmd = await fs.readFile(path.join(packaging, "launchers", "launcher.cmd"), "utf8");
  await fs.writeFile(path.join(launchers, names.launcher), renderLauncher(sh, names), { mode: 0o755 });
  await fs.writeFile(
    path.join(launchers, `${names.launcher}.cmd`),
    renderLauncher(cmd, names, { crlf: true }),
  );

  const notices = path.join(out, "THIRD_PARTY_NOTICES.txt");
  await fs.writeFile(
    notices,
    await noticesText({
      nodeModules: [path.join(app, "node_modules"), path.join(cli, "node_modules")],
      scope: SCOPE,
      required: REQUIRED_NOTICES,
      title: `Third-party software in ${names.productName} ${version} (app, command line and MCP server)`,
    }),
  );

  const appManifest = await readJson(path.join(root, "packages", "app", "package.json"));
  const env = {
    REQSEQ_ELECTRON_VERSION: appManifest.devDependencies.electron,
    REQSEQ_STAGED_CLI: cli,
    REQSEQ_STAGED_LAUNCHERS: launchers,
    REQSEQ_NOTICES: notices,
    REQSEQ_JUNIT_GUIDE: path.join(root, "toolchain", "junit"),
    REQSEQ_DELIVERY_DIR: delivery,
  };
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
  }
  console.log(
    Object.entries(env)
      .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
      .join("\n"),
  );
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
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
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

const [mode, argument] = process.argv.slice(2);
if (mode === undefined) {
  await stage();
} else if (mode === "--pack") {
  await pack();
} else if (mode === "--check-tag" && argument !== undefined) {
  const ok = tagReleasesVersion(argument, version);
  console.log(ok ? `${argument} releases ${version}` : `${argument} does not release version ${version}`);
  process.exitCode = ok ? 0 : 1;
} else if (mode === "--release-notes" && argument !== undefined) {
  process.stdout.write(notes(argument));
} else {
  console.error("usage: node scripts/package/stage.mjs [--pack | --check-tag <tag> | --release-notes <ref>]");
  process.exitCode = 2;
}
