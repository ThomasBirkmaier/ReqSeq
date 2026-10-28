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

const launchers = staged("LOGREQ_STAGED_LAUNCHERS");

export default {
  appId: names.appId,
  productName: names.productName,
  electronVersion: staged("LOGREQ_ELECTRON_VERSION"),
  directories: { output: staged("LOGREQ_DELIVERY_DIR") },
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
      from: dirname(staged("LOGREQ_STAGED_CLI")),
      to: ".",
      filter: [
        `${basename(staged("LOGREQ_STAGED_CLI"))}/**/*`,
        "!**/*.map",
        "!**/*.d.ts",
        "!**/*.tsbuildinfo",
      ],
    },
    { from: staged("LOGREQ_NOTICES"), to: "THIRD_PARTY_NOTICES.txt" },
    {
      from: staged("LOGREQ_JUNIT_GUIDE"),
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
  },
  mac: {
    target: [{ target: "zip", arch: ["arm64"] }],
    artifactName: names.artifact.replace("${os}", "mac"),
    // Ad-hoc: Apple silicon runs no unsigned code; no certificate is used (ADR-0014).
    identity: "-",
    hardenedRuntime: false,
    category: "public.app-category.developer-tools",
    extraResources: [{ from: `${launchers}/${names.launcher}`, to: `bin/${names.launcher}` }],
  },
  linux: {
    target: [{ target: "tar.gz", arch: ["x64"] }],
    artifactName: names.artifact.replace("${os}", "linux"),
    executableName: names.productName,
    extraFiles: [{ from: `${launchers}/${names.launcher}`, to: `bin/${names.launcher}` }],
  },
  win: {
    target: [{ target: "zip", arch: ["x64"] }],
    artifactName: names.artifact.replace("${os}", "win"),
    signAndEditExecutable: false,
    extraFiles: [{ from: `${launchers}/${names.launcher}.cmd`, to: `bin/${names.launcher}.cmd` }],
  },
};
