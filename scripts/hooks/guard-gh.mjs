#!/usr/bin/env node
// PreToolUse hook on Bash and the GitHub MCP tool `issue_write` (.claude/settings.json). It stops two mistakes early:
// `gh issue` and `gh pr` in a cloud session, which has no GitHub GraphQL and fails with 403 (CLAUDE.md, Traps), and a
// new issue without a milestone (CLAUDE.md, Issues).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Only at a command position, so `gh pr` inside a commit message or a quoted body does not count.
const GH_GRAPHQL = /(?:^|[;&|\n]|\$\()\s*gh\s+(?:issue|pr)\b/;
// `gh api repos/<owner>/<repo>/issues` with a title field creates an issue; comments, labels and edits have a longer path.
const GH_CREATE_ISSUE =
  /(?:^|[;&|\n]|\$\()\s*gh\s+api\s[^;&|\n]*?repos\/[^/\s]+\/[^/\s]+\/issues["']?\s[^;&|\n]*?-[fF]\s+["']?title=/;
const GH_MILESTONE = /-[fF]\s+["']?milestone=/;

const NO_MILESTONE =
  "A new issue needs a milestone: the open version x.y whose goal it serves, a bug or flake the next one. " +
  "Check the open epics too: a step of one becomes its sub-issue (CLAUDE.md, Issues). " +
  "List them with `gh api 'repos/ThomasBirkmaier/ReqSeq/milestones'` and " +
  "`gh api 'repos/ThomasBirkmaier/ReqSeq/issues?labels=epic'`.";

/** Exit code and message for one hook input: 2 blocks the tool call. */
export function check(input, env = process.env) {
  const tool = input?.tool_input ?? {};
  if (input?.tool_name === "mcp__github__issue_write") {
    return tool.method === "create" && !tool.milestone ? { code: 2, message: NO_MILESTONE } : { code: 0 };
  }
  const command = tool.command;
  if (typeof command !== "string") {
    return { code: 0 };
  }
  if (GH_CREATE_ISSUE.test(command) && !GH_MILESTONE.test(command)) {
    return { code: 2, message: NO_MILESTONE };
  }
  if (env.CLAUDE_CODE_REMOTE === "true" && GH_GRAPHQL.test(command)) {
    return {
      code: 2,
      message:
        "`gh issue` and `gh pr` use GraphQL, which fails with 403 in cloud sessions. " +
        "Use the GitHub MCP tools or `gh api repos/ThomasBirkmaier/ReqSeq/...` (REST).",
    };
  }
  return { code: 0 };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const { code, message } = check(JSON.parse(fs.readFileSync(0, "utf8") || "{}"));
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.exit(code);
}
