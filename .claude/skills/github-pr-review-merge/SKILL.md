---
name: github-pr-review-merge
description: Reviews a LogReq pull request, fixes or files blocking findings, resolves merge conflicts and merges it autonomously when all checks are green (D-051). Use when a PR from github-issue-workflow is ready, or when asked to review or merge a PR.
---

# PR review and merge (LogReq, autonomous)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

Adapted from the Capybara skill. Difference: no human confirmation before merge.

1. **Load.** `gh pr view <n> --json title,body,labels,files,mergeable,statusCheckRollup,headRefName`. Read the linked issue and SR file.
2. **No human gate.** Agents merge every PR themselves, including changes to schemas, ADRs, CLAUDE.md, skills and CI (D-051). For those, post a one-line note to the stage epic so the product owner sees it later. Skip PRs labelled `blocked` or `needs-human`.
3. **Review (Opus subagent, effort high; `xhigh` for SR-111 and SR-117)** if the workflow review is older than the last push: correctness against SR and AK, edge cases, tests named `[SR-xxx/AKn]` for every AK with method Test, product rules in `CLAUDE.md`, scope (only what the PR claims).
   Classify findings: blocking, should-fix, nitpick. The review does not wait for CI, starts with a summary of at most five lines, and lists only findings with their fixes (#722).
4. **Blocking findings.** Only a blocking finding or red CI starts a fix round; wrong or missing AK tags, trace and breaches of the repository text rule count as blocking; should-fix items and nitpicks go to the collective follow-up issue of the area (CLAUDE.md, "Workflow", #722). If small and in scope: fix on the branch (back through tests and gates), together with the should-fix items and nitpicks. Otherwise open a linked issue with the findings, label the PR `blocked`, comment, and stop.
5. **Conflicts.** Merge `main` into the branch with `pnpm merge:main` (regenerates generated files; conflicts resolved by hand get a review of that diff), keep the intent of both sides, re-run all gates. If the two sides are incompatible, label `needs-human`, explain the options for the product owner, and stop.
6. **Merge** when all checks are green and nothing blocking is open. Merge as soon as that holds: subscribe to the PR's activity and, on a CI event, check the check runs of the head commit (`GET /repos/ThomasBirkmaier/logreq/commits/{sha}/check-runs?per_page=100`): `checks (ubuntu-24.04)` and `electron (ubuntu-24.04)` exist and concluded `success`, the newest `trace-check (PR text)` that was not skipped, if any, concluded `success`, every other check run completed with `success` or `skipped` (`electron` is green with skipped steps on a docs-only PR, #520; auto-merge is not available, see CLAUDE.md). If `checks` failed only in its Trace check step (the PR text) or in a flaky step, and the cause is fixed without a push, re-run the failed jobs of that run: `POST /repos/ThomasBirkmaier/logreq/actions/runs/{run_id}/rerun-failed-jobs` (Trace check reads the current PR text; a green `trace-check (PR text)` does not replace it). Check the text locally first with `pnpm trace-check --pr-body <file>`, and find the failed step with `GET /repos/ThomasBirkmaier/logreq/actions/runs/{run_id}/jobs` (`steps[].conclusion`); the check-run annotation only says "exit code 1" (#566). Merge with `PUT /repos/ThomasBirkmaier/logreq/pulls/{n}/merge` (`merge_method: squash`), then delete the branch; the intent in `gh` terms: `gh pr merge <n> --squash --delete-branch`. The squash message keeps the `Implements:` trailers.
7. **After merge.** Comment on the SR issue with the merge commit and the test names that cover each AK. Check the stage epic checkbox. Remove `agent:working`.

Never approve your own PR as a GitHub review; merging is allowed by D-051, approving is not needed.
