#!/usr/bin/env node
// PreToolUse hook on Bash (.claude/settings.json): cloud sessions have no GitHub GraphQL, so `gh issue` and `gh pr`
// fail there with 403. The hook stops them early and names the REST route (CLAUDE.md, Traps).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Only at a command position, so `gh pr` inside a commit message or a quoted body does not count.
const GH_GRAPHQL = /(?:^|[;&|\n]|\$\()\s*gh\s+(?:issue|pr)\b/;

/** Exit code and message for one hook input: 2 blocks the tool call, only in a cloud session. */
export function check(input, env = process.env) {
  const command = input?.tool_input?.command;
  if (env.CLAUDE_CODE_REMOTE !== "true" || typeof command !== "string" || !GH_GRAPHQL.test(command)) {
    return { code: 0 };
  }
  return {
    code: 2,
    message:
      "`gh issue` and `gh pr` use GraphQL, which fails with 403 in cloud sessions. " +
      "Use the GitHub MCP tools or `gh api repos/ThomasBirkmaier/ReqSeq/...` (REST).",
  };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const { code, message } = check(JSON.parse(fs.readFileSync(0, "utf8") || "{}"));
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.exit(code);
}
