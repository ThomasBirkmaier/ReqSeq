---
name: github-pr-review-merge
description: Reviews a LogReq pull request, fixes or files blocking findings, resolves merge conflicts and merges it autonomously when all required checks are green (D-051). Use when a PR from github-issue-workflow is ready, or when asked to review or merge a PR.
---

# PR review and merge (LogReq, autonomous)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

Adapted from the Capybara skill. Difference: no human confirmation before merge, except for PRs with label `needs-human`.

1. **Load.** `gh pr view <n> --json title,body,labels,files,mergeable,statusCheckRollup,headRefName`. Read the linked issue and SR file.
2. **Gate on label.** If the PR has `needs-human` or touches `schemas/`, `docs/adr/`, `docs/architecture/`, `CLAUDE.md`, `.claude/`, `.github/`: make sure the label is set, request review from ThomasBirkmaier, comment a short summary, and stop. Do not merge.
3. **Review (Opus subagent)** if the workflow review is older than the last push: correctness against SR and AK, edge cases, tests named `[SR-xxx/AKn]` for every AK with method Test, product rules in `CLAUDE.md`, scope (only what the PR claims).
   Classify findings: blocking, should-fix, nitpick.
4. **Blocking findings.** If small and in scope: fix on the branch (back through tests and gates). Otherwise open a linked issue with the findings, label the PR `blocked`, comment, and stop.
5. **Conflicts.** Rebase or merge `main` into the branch, keep the intent of both sides, re-run all gates. If the two sides are incompatible, label `needs-human` and explain.
6. **Merge** when all required checks are green and nothing blocking is open: `gh pr merge <n> --squash --delete-branch`. The squash message keeps the `Implements:` trailers.
7. **After merge.** Comment on the SR issue with the merge commit and the test names that cover each AK. Check the stage epic checkbox. Remove `agent:working`.

Never approve your own PR as a GitHub review; merging is allowed by D-051, approving is not needed.
