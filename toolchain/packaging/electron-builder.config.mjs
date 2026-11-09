// electron-builder configuration of the delivery (ADR-0014): one portable artifact per system. Every name comes
// from names.json; the paths of the staged folders come from scripts/package/stage.mjs (environment below).
// Run by the release workflow with --projectDir set to the staged app.
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const names = JSON.parse(readFileSync(join(import.meta.dirname, "names.json"), "utf8"));

/** A path that stage.mjs sets; the build stops when it is missing. */
const staged = (name) => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set: run scripts/package/stage.mjs first`);
  }
  return value;
};

const launchers = staged("REQSEQ_STAGED_LAUNCHERS");
const electronVersion = staged("REQSEQ_ELECTRON_VERSION");

// The SHA-256 sums of the Electron zips, from the electron package the workspace lockfile pins (#1234). Without
// them, @electron/get fetches SHASUMS256.txt from the Electron release on every build, even with the zip cached,
// and a 504 there fails the build. The zip is still checked against these sums.
const electronPackage = join(import.meta.dirname, "..", "..", "packages", "app", "node_modules", "electron");
const electronPackageVersion = JSON.parse(
  readFileSync(join(electronPackage, "package.json"), "utf8"),
).version;
if (electronPackageVersion !== electronVersion) {
  throw new Error(
    `electron ${electronPackageVersion} is installed, but ${electronVersion} is packaged: run pnpm install`,
  );
}
const electronChecksums = JSON.parse(readFileSync(join(electronPackage, "checksums.json"), "utf8"));

// The app icon (#410), generated from icon/icon.svg by scripts/icon/generate.mjs.
const icon = (name) => join(import.meta.dirname, "icon", name);

export default {
  appId: names.appId,
  productName: names.productName,
  electronVersion,
  electronDownload: { checksums: electronChecksums },
  directories: { output: staged("REQSEQ_DELIVERY_DIR") },
  files: ["package.json", "out/**", "node_modules/**", "!**/*.map", "!**/*.d.ts", "!**/*.tsbuildinfo"],
  asar: true,
  // No native modules; and the staged node_modules is complete.
  npmRebuild: false,
  nodeGypRebuild: false,
  // Nothing to update from (SR-078): no update configuration, and electron-builder never publishes.
  publish: null,
  extraResources: [
    // From the parent folder: electron-builder always leaves out the node_modules folder directly under `from`.
    {
      from: dirname(staged("REQSEQ_STAGED_CLI")),
      to: ".",
      filter: [
        `${basename(staged("REQSEQ_STAGED_CLI"))}/**/*`,
        "!**/*.map",
        "!**/*.d.ts",
        "!**/*.tsbuildinfo",
      ],
    },
    { from: staged("REQSEQ_NOTICES"), to: "THIRD_PARTY_NOTICES.txt" },
    {
      from: staged("REQSEQ_JUNIT_GUIDE"),
      to: "docs/junit",
      filter: ["**/*", "!**/__pycache__/**", "!**/.pytest_cache/**"],
    },
  ],
  // ADR-0014: a fuse applies to the whole binary; the launcher needs RunAsNode.
  electronFuses: {
    runAsNode: true,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true,
    // macOS and Windows check app.asar against the hash electron-builder writes into the bundle (#939).
    enableEmbeddedAsarIntegrityValidation: true,
  },
  mac: {
    target: [{ target: "zip", arch: ["arm64"] }],
    artifactName: names.artifact.replace("${os}", "mac"),
    // Ad-hoc: Apple silicon runs no unsigned code; no certificate is used (ADR-0014).
    identity: "-",
    hardenedRuntime: false,
    category: "public.app-category.developer-tools",
    icon: icon("icon.icns"),
    extraResources: [{ from: `${launchers}/${names.launcher}`, to: `bin/${names.launcher}` }],
  },
  linux: {
    target: [{ target: "tar.gz", arch: ["x64"] }],
    artifactName: names.artifact.replace("${os}", "linux"),
    executableName: names.productName,
    icon: icon("icons"),
    extraFiles: [{ from: `${launchers}/${names.launcher}`, to: `bin/${names.launcher}` }],
  },
  win: {
    target: [{ target: "zip", arch: ["x64"] }],
    artifactName: names.artifact.replace("${os}", "win"),
    icon: icon("icon.ico"),
    // Writes the icon and version into the exe with rcedit; nothing is signed without a certificate (ADR-0014).
    signAndEditExecutable: true,
    extraFiles: [{ from: `${launchers}/${names.launcher}.cmd`, to: `bin/${names.launcher}.cmd` }],
  },
};
