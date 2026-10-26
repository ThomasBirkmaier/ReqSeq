---
name: github-pr-review-merge
description: Reviews a LogReq pull request, fixes or files blocking findings, resolves merge conflicts and merges it autonomously when all checks are green (D-051). Use when a PR from github-issue-workflow is ready, or when asked to review or merge a PR.
---

# PR review and merge (LogReq, autonomous)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

Adapted from the Capybara skill. Difference: no human confirmation before merge.

1. **Load.** `gh pr view <n> --json title,body,labels,files,mergeable,statusCheckRollup,headRefName`. Read the linked issue and SR file.
2. **No human gate.** Agents merge every PR themselves, including changes to schemas, ADRs, CLAUDE.md, skills and CI (D-051). For those, post a one-line note to the stage epic so the product owner sees it later. Skip PRs labelled `blocked` or `needs-human`.
3. **Review (Opus subagent, effort high)** if the workflow review is older than the last push: correctness against SR and AK, edge cases, tests named `[SR-xxx/AKn]` for every AK with method Test, product rules in `CLAUDE.md`, scope (only what the PR claims).
   Classify findings: blocking, should-fix, nitpick.
4. **Blocking findings.** If small and in scope: fix on the branch (back through tests and gates). Otherwise open a linked issue with the findings, label the PR `blocked`, comment, and stop.
5. **Conflicts.** Merge `main` into the branch with `pnpm merge:main` (regenerates generated files; conflicts resolved by hand get a review of that diff), keep the intent of both sides, re-run all gates. If the two sides are incompatible, label `needs-human`, explain the options for the product owner, and stop.
6. **Merge** when all checks are green and nothing blocking is open. Merge as soon as that holds: subscribe to the PR's activity and, on a CI event, check every check run of the head commit (`GET /repos/ThomasBirkmaier/logreq/commits/{sha}/check-runs`, all completed with success or skipped; auto-merge is not available, see CLAUDE.md). Merge with `PUT /repos/ThomasBirkmaier/logreq/pulls/{n}/merge` (`merge_method: squash`), then delete the branch; the intent in `gh` terms: `gh pr merge <n> --squash --delete-branch`. The squash message keeps the `Implements:` trailers.
7. **After merge.** Comment on the SR issue with the merge commit and the test names that cover each AK. Check the stage epic checkbox. Remove `agent:working`.

Never approve your own PR as a GitHub review; merging is allowed by D-051, approving is not needed.
