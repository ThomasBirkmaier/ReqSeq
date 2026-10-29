#!/usr/bin/env node
// PreToolUse hook (.claude/settings.json): blocks Edit and Write on files that only tools write.
// Generated files come from `pnpm contracts:generate`, spec elements from the LogReq CLI or MCP (D-064).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  { pattern: /^schemas\/generated\//, fix: "run `pnpm contracts:generate`" },
  { pattern: /^packages\/core\/src\/generated\//, fix: "run `pnpm contracts:generate`" },
  {
    pattern: /^spec\/(?!metamodel\/|logreq-workspace\.yaml$|README\.md$)/,
    fix: "use the LogReq CLI or MCP with `--workspace spec` (see the spec-change skill)",
  },
];

/** Returns the reason a repository-relative path must not be edited by hand, or undefined. */
export function protectedReason(relPath) {
  const posix = relPath.split(path.sep).join("/");
  const rule = RULES.find((r) => r.pattern.test(posix));
  return rule && `${posix} is written by a tool, not by hand: ${rule.fix}.`;
}

/** Finds the nearest existing directory, so a file that does not exist yet can be resolved too. */
function existingDir(file) {
  let dir = path.dirname(file);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  return dir;
}

/** Finds the LogReq checkout (main checkout or worktree) that contains the file, with symlinks resolved. */
export function repoRoot(file) {
  try {
    const root = execFileSync("git", ["-C", existingDir(file), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return fs.existsSync(path.join(root, "spec", "logreq-workspace.yaml"))
      ? fs.realpathSync(root)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Exit code and message for one hook input: 2 blocks the tool call. */
export function check(input) {
  const file = input?.tool_input?.file_path;
  if (typeof file !== "string") {
    return { code: 0 };
  }
  const abs = path.resolve(input.cwd ?? process.cwd(), file);
  const root = repoRoot(abs);
  if (!root) {
    return { code: 0 };
  }
  const dir = existingDir(abs);
  const real = path.join(fs.realpathSync(dir), path.relative(dir, abs));
  const reason = protectedReason(path.relative(root, real));
  return reason ? { code: 2, message: reason } : { code: 0 };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const { code, message } = check(JSON.parse(fs.readFileSync(0, "utf8") || "{}"));
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.exit(code);
}
