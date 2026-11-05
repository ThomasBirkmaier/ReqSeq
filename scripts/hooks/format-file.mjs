#!/usr/bin/env node
// PostToolUse hook on Edit and Write (.claude/settings.json): formats the edited file with the repository's Prettier,
// so `pnpm format:check` stays green. Files Prettier ignores or cannot parse stay as they are; the hook never blocks.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prettier = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");

/** The Prettier arguments for one hook input, or undefined when the file is outside this checkout or gone. */
export function prettierArgs(input) {
  const file = input?.tool_input?.file_path;
  if (typeof file !== "string") {
    return undefined;
  }
  const abs = path.resolve(input.cwd ?? root, file);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(abs) || !fs.existsSync(prettier)) {
    return undefined;
  }
  return [prettier, "--write", "--ignore-unknown", "--log-level", "silent", abs];
}

/** Formats the file of one hook input; a Prettier error (for example a syntax error mid-edit) is ignored. */
export function run(input, exec = execFileSync) {
  const args = prettierArgs(input);
  if (!args) {
    return false;
  }
  try {
    exec(process.execPath, args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  run(JSON.parse(fs.readFileSync(0, "utf8") || "{}"));
}
