#!/usr/bin/env node
// SessionStart hook (.claude/settings.json): in a cloud container, installs the pnpm the repository pins when
// corepack cannot start it (verify skill, "First: pnpm 12"). Local machines are left alone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The pinned pnpm spec from package.json, such as `pnpm@12.14.0`. */
export function pinnedPnpm(dir = root) {
  const { packageManager } = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  return packageManager.split("+")[0];
}

/** Installs the pinned pnpm when the session runs in the cloud and `pnpm --version` fails; returns what it did. */
export function run(env = process.env, exec = execFileSync) {
  if (env.CLAUDE_CODE_REMOTE !== "true") {
    return "local";
  }
  try {
    exec("pnpm", ["--version"], { cwd: root, stdio: "ignore" });
    return "ok";
  } catch {
    exec("npm", ["install", "-g", pinnedPnpm(), "--force"], { cwd: root, stdio: "ignore" });
    return "installed";
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (run() === "installed") {
      process.stdout.write(`Installed ${pinnedPnpm()} because corepack could not start it.\n`);
    }
  } catch (error) {
    process.stderr.write(`Could not install pnpm: ${error.message}\n`);
  }
}
