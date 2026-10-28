# From review to merge

**Review.** A second agent reviews each PR once with the built-in `/code-review` (D-051, D-065). It runs at effort `medium`, or `high` for a risky change as CLAUDE.md defines it. It starts at the push and does not wait for CI. Give it the issue and the SR as well as the PR. Besides the code, it checks what only LogReq has: the product rules and the repository text rule in CLAUDE.md, AK tags and trace, and written reasons for every ignore (ADR-0016). Use `/security-review` in addition for changes to file access, the bridge between the app's processes, or the dependencies.

## Filter: a separate step by the lead or author

The filter applies this list and never downgrades a finding on it. Blocking findings are correctness, a broken product rule, wrong or missing AK tags or trace, a breach of the repository text rule, and an unjustified ignore or weakened gate. A blocking finding or red CI starts one fix round, which also takes that PR's should-fix items. Send the fix round to the agent that wrote the code (SendMessage) while it is reachable, which is within about an hour while its cache lasts. Otherwise start a fresh agent with the plan, the findings and the diff. The fix needs no new review, unless it adds logic the findings did not ask for. A blocking finding too large for the PR becomes a linked issue; the PR gets `blocked` and waits. Without a blocking finding, the should-fix items and notes go into the collective follow-up issue of the area, and the PR merges on green CI.

## Conflicts

Merge `main` with `pnpm merge:main`, which regenerates conflicting generated files. A conflict resolved by hand needs a look at that diff before the merge. If the two sides cannot both be kept, label the PR `needs-human` and give the product owner the options.

## Merge as soon as it is green

PRs labelled `blocked` or `needs-human` are not merged. GitHub auto-merge is not available. Subscribe to the PR's activity and merge on the CI event, when the check runs of the head commit (`GET /repos/ThomasBirkmaier/logreq/commits/{sha}/check-runs?per_page=100`) show all of this:

- `checks (ubuntu-24.04)` and `electron (ubuntu-24.04)` exist and concluded `success`. One green workflow is not enough, and `electron` is green with skipped steps on a docs-only PR (#520).
- The newest `trace-check (PR text)` that was not skipped, if there is one, concluded `success`.
- Every other check run completed with `success` or `skipped`. The one exception is a PR that works on performance (product owner decision, 2026-10-28): there `perf` may be red when every row over its limit was already over it on main and no measurement is worse. The PR names the rows and the comparison.

If `checks` failed only in its Trace check step or in a flaky step, and you fixed the cause without a push, re-run the failed jobs: `POST /repos/ThomasBirkmaier/logreq/actions/runs/{run_id}/rerun-failed-jobs`. Check the text first with `pnpm trace-check --pr-body <file>`; a green `trace-check (PR text)` does not replace the rerun. You find the failed step with `GET .../actions/runs/{run_id}/jobs` (`steps[].conclusion`), because the annotation only says "exit code 1" (#566).

Merge with `PUT /repos/ThomasBirkmaier/logreq/pulls/{n}/merge` and `merge_method: squash`, keeping the `Implements:` trailers, then delete the branch. Use `rebase` instead only when the commits should stay revertible one by one. Never merge red, and never approve your own PR.

## After the merge

Comment on the SR issue with the merge commit and the tests that cover each AK, tick the stage epic, and remove `agent:working`. For a PR that changes the spec, schemas, ADRs, agent rules, skills or CI, add one line in the stage epic for the product owner, without waiting for an answer.
