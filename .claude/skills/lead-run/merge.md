# From review to merge

**Draft first (#303).** Open every PR as a draft: a draft runs only the Ubuntu lane of CI, so the pushes while it is worked on are cheap. Push once per round (the first push, then one push per fix round), never in between. When the Ubuntu lane is green on the last push of the review round (or of the first push, if the review had no blocking finding), mark the PR ready for review with the GitHub MCP tool `update_pull_request` (`draft: false`; REST cannot do it). That run and each later push run both lanes at once (#412). A PR that only changes docs or rules may be opened ready at once.

**Size.** `static` warns when a PR changes more than 800 lines without generated files (step `Pull request size`). Split such a PR before marking it ready, unless its change cannot be split; then the PR text says why.

**Review.** A second agent reviews each PR once with the built-in `/code-review` (D-051, D-065). It runs at effort `medium`, or `high` for a risky change as CLAUDE.md defines it. It starts at the push and does not wait for CI. Give it the issue and the SR as well as the PR. Besides the code, it checks what only ReqSeq has: the product rules and the repository text rule in CLAUDE.md, AK tags and trace, and written reasons for every ignore (ADR-0016). For every AK of the SR with method Test it names the test, the access through which the test triggers the behaviour, and the result it asserts; for the other methods it checks the record in `verification/` (#389). For each blocking finding it gives the file and line, why it is wrong, and how to show that it fails (a test, an input or a command). Use `/security-review` in addition for changes to file access, the bridge between the app's processes, or the dependencies.

## Filter: a separate step by the lead or author

The filter applies this list and never downgrades a finding on it. Blocking findings are correctness, a broken product rule, wrong or missing AK tags or trace, an AK with method Test that no test triggers through the access the AK names, a breach of the repository text rule, and an unjustified ignore or weakened gate. A blocking finding or red CI starts one fix round, which also takes that PR's should-fix items. Send the fix round to the agent that wrote the code (SendMessage) while it is reachable, because it still has the context; its prompt cache lasts only about five minutes, so send the findings soon after the review. Otherwise start a fresh agent with the plan, the findings and the diff. The fix needs no new review, unless it adds logic the findings did not ask for. A blocking finding too large for the PR becomes a linked issue; the PR gets `blocked` and waits. Without a blocking finding, the should-fix items and notes go into the collective follow-up issue of the area, and the PR merges on green CI.

## Conflicts and stacked PRs

No stacked PRs (#412): branch every PR from `main`, never from another PR's branch. A squash merge of the lower PR forces every PR above it to merge `main` and run the whole CI again; on 2026-10-29 runs that only merged `main`, mostly in stacked PRs, were a third of all macOS and Windows runs. Work that builds on an open PR waits for its merge, or goes into the same PR.

Merge `main` into a PR only when GitHub reports a conflict, or after a change of its base branch (below). The ruleset does not require an up-to-date branch, so merging `main` without a conflict only starts a full run. Merge it with `pnpm merge:main`, which regenerates conflicting generated files. A conflict resolved by hand needs a look at that diff before the merge. If the two sides cannot both be kept, label the PR `needs-human` and give the product owner the options.

## Merge as soon as it is green

PRs labelled `blocked` or `needs-human` are not merged. Once the review has no open blocking finding and the PR is not a draft, enable GitHub auto-merge with the GitHub MCP tool `enable_pr_auto_merge` (`mergeMethod: SQUASH`) and subscribe to the PR's activity (#412): GitHub merges when the required checks pass. A later push keeps auto-merge on, so disable it (`disable_pr_auto_merge`) before a push that needs a new review. Auto-merge reads only the required checks, not `trace-check (PR text)` or the other checks below: so a PR that works on performance (`perf` below) is merged by hand, and before editing a PR's title or body or its label `enabler` or `spec-export`, disable auto-merge and enable it again once `trace-check (PR text)` passed. If GitHub refuses it, or another check below is red, merge by hand on the check-run event, when the check runs of the head commit (`GET /repos/ThomasBirkmaier/ReqSeq/commits/{sha}/check-runs?per_page=100`) show all of this:

- The PR is not a draft, and `static` as well as `checks` and `electron` for `ubuntu-24.04`, `macos-26` and `windows-2025` exist on the head commit and concluded `success`. Each of these names needs one `success` on the head commit; cancelled runs of the same name from superseded runs do not count against it, and skipped matrix jobs show names like `checks (${{ matrix.os }})` or `electron (ubuntu-24.04, ${{ matrix.shard }}/2)` and do not count; one green workflow is not enough, and `electron` is green with skipped steps on a docs-only PR (#520).
- The newest `trace-check (PR text)` that was not skipped, if there is one, concluded `success`. It runs in `pr-text.yml`, not in CI, because GitHub reads the required checks from the newest CI run of the head commit (#372).
- Every other check run completed with `success` or `skipped`. The one exception is a PR that works on performance (product owner decision, 2026-10-28): there `perf` may be red when every row over its limit was already over it on main and no measurement is worse. The PR names the rows and the comparison. The label `perf` starts the perf job once when it is added, not on later pushes, so add it after the last reviewed push, and measure the comparison locally in the container.

A change of the base branch starts no CI run (#372): after it, merge the new base with `pnpm merge:main` and push before the merge, so the checks ran against it.

If `static` failed only in its Trace check step and you fixed the PR text or its label `enabler`, `trace-check (PR text)` re-runs `static` once the CI run has completed. Check the text first with `pnpm trace-check --pr-body <file>`. Agents cannot re-run other jobs (403): a job that failed in a flaky step needs the next real push, never an empty commit. You find the failed step with `GET .../actions/runs/{run_id}/jobs` (`steps[].conclusion`), because the annotation only says "exit code 1" (#566).

Merge with `PUT /repos/ThomasBirkmaier/ReqSeq/pulls/{n}/merge` and `merge_method: squash`, keeping the `Implements:` trailers; GitHub deletes the branch. Use `rebase` instead only when the commits should stay revertible one by one. Never merge red, and never approve your own PR.

## After the merge

The steps below follow every merge, an auto-merge too: its `closed` event wakes the subscribed session.

`main` gets no CI run of its own after a merge, only the nightly run and a manual one (product owner decision, 2026-10-28). A red nightly run is the first work of the morning, fixed through a PR to `main` (#340). This is no licence to merge without green PR CI.

Comment on the SR issue with the merge commit and the tests that cover each AK, and reopen it if an AK with method Test has none (the merge closes it through `Closes #`), tick the stage epic, and remove `agent:working`. For a PR that changes the spec, schemas, ADRs, agent rules, skills or CI, add one line in the stage epic for the product owner, without waiting for an answer.
