---
name: merge
description: Review and merge rules for every ReqSeq pull request - draft first, the ready-PR limit, the review with /code-review, the blocker filter, auto-merge and the merge criteria, CI changes, issue labels and closing, and the release steps. Use when opening, reviewing or merging a ReqSeq PR, closing an issue, or preparing a release.
---

# From review to merge

**Draft first (#303).** Open every PR as a draft: a draft runs only the Ubuntu lane of CI, so the pushes while it is worked on are cheap. Push once per round (the first push, then one push per fix round), never in between. When the Ubuntu lane is green on the last push of the review round (or of the first push, if the review had no blocking finding), mark the PR ready for review with the GitHub MCP tool `update_pull_request` (`draft: false`; REST cannot do it). That run and each later push run both lanes at once (#412). At most three PRs are ready at a time across all sessions, more for a while when the coordinator says CI has room (count them: `gh api 'repos/ThomasBirkmaier/ReqSeq/pulls?state=open' --jq '[.[]|select(.draft|not)]|length'`); the others stay drafts until one has merged, because a ready PR starts eleven jobs and the account runs at most 40 at once, 5 on macOS (product owner decision, 2026-11-06, #739). Docs- and rule-only PRs skip the builds and do not count. A PR that only changes docs or rules may be opened ready at once.

**Label.** Label an enabler PR `enabler` when you open it, for the board. No check reads the PR text or the label `enabler` (product owner decision, 2026-11-06), so editing them never needs a new CI run.

**Size.** `static` warns when a PR changes more than 800 lines without generated files (step `Pull request size`). Split such a PR before marking it ready, unless its change cannot be split; then the PR text says why.

**Review.** A second agent reviews each PR once with the built-in `/code-review`. It runs at effort `medium`, or `high` for a risky change as CLAUDE.md defines it. It starts at the push and does not wait for CI. Give it the issue and the SR as well as the PR. Besides the code, it checks what only ReqSeq has: the product rules and the repository text rule in CLAUDE.md, AK tags and trace, and written reasons for every ignore (ADR-0016). For every AK of the SR with method Test it names the test, the access through which the test triggers the behaviour, and the result it asserts; for the other methods it checks the record in `verification/` (#389). For each blocking finding it gives the file and line, why it is wrong, and how to show that it fails (a test, an input or a command). For an AK with visible behaviour, the PR shows the evidence: the CLI output, or a light-theme screenshot from the PR's Electron test; a PR writes no demo file. Use `/security-review` in addition for changes to file access, the bridge between the app's processes, or the dependencies.

## Filter: a separate step by the author or the session that started the review

The filter applies this list and never downgrades a finding on it. Blocking findings are correctness, a broken product rule, wrong or missing AK tags or trace, an AK with method Test that no test triggers through the access the AK names (for all four accesses, a core test plus a tagged cross-access scenario; an app test only for app UI), a breach of the repository text rule, and an unjustified ignore or weakened gate. A blocking finding or red CI starts one fix round, which also takes that PR's should-fix items. Send the fix round to the agent that wrote the code (SendMessage) while it is reachable, because it still has the context; its prompt cache lasts only about five minutes, so send the findings soon after the review. Otherwise start a fresh agent with the plan, the findings and the diff. The fix needs no new review, unless it adds logic the findings did not ask for. A blocking finding too large for the PR is fixed in a PR of its own, which this PR waits for with `blocked`; it becomes an issue only if it meets the issue threshold in CLAUDE.md. Without a blocking finding, small should-fix items are fixed in the PR, the rest stay as notes in the PR description and become no issue (issue threshold in CLAUDE.md), and the PR merges on green CI.

## CI changes

`main` blocks force-pushes and deletion and requires the checks `static` plus `checks` and `electron` on each of `ubuntu-24.04`, `macos-26` and `windows-2025`. A CI change that aims at speed or cost names its measure and its baseline, and is measured again two days after its merge with the same method; it is reverted if it missed its target (product owner decision, 2026-10-30, #412). When a condition behind the CI strategy changes (runner cost, visibility, required checks), check the strategy again.

## Conflicts and stacked PRs

No stacked PRs (#412): branch every PR from `main`, never from another PR's branch. A squash merge of the lower PR forces every PR above it to merge `main` and run the whole CI again. Work that builds on an open PR waits for its merge, or goes into the same PR.

Merge `main` into a PR only when GitHub reports a conflict, after a change of its base branch (below), or when the PR is red because `main` is (an open issue labelled `main-red`, written by `main-check.yml`, #796; fix `main` first, then merge it into the PRs it broke). The ruleset does not require an up-to-date branch, so merging `main` without a conflict only starts a full run. Merge it with `pnpm merge:main`, which regenerates conflicting generated files. A conflict resolved by hand needs a look at that diff before the merge. If the two sides cannot both be kept, label the PR `needs-human` and give the product owner the options.

## Merge as soon as it is green

PRs labelled `blocked` or `needs-human` are not merged. Once the review has no open blocking finding and the PR is not a draft, enable GitHub auto-merge with the GitHub MCP tool `enable_pr_auto_merge` (`mergeMethod: SQUASH`) and subscribe to the PR's activity (#412): GitHub merges when the required checks pass. A later push keeps auto-merge on, so disable it (`disable_pr_auto_merge`) before a push that needs a new review. Auto-merge reads only the required checks, not the other checks below: so a PR that works on performance (`perf` below) is merged by hand. If GitHub refuses it, or another check below is red, merge by hand on the check-run event, when the check runs of the head commit (`GET /repos/ThomasBirkmaier/ReqSeq/commits/{sha}/check-runs?per_page=100`) show all of this:

- The PR is not a draft, and `static` as well as `checks` and `electron` for `ubuntu-24.04`, `macos-26` and `windows-2025` exist on the head commit and concluded `success`. Each of these names needs one `success` on the head commit; cancelled runs of the same name from superseded runs do not count against it, and skipped matrix jobs show names like `checks (${{ matrix.os }})` or `electron (ubuntu-24.04, ${{ matrix.shard }}/2)` and do not count; one green workflow is not enough, and `electron` is green with skipped steps on a docs-only PR (ThomasBirkmaier/ReqSeq-archive#520).
- Every other check run completed with `success` or `skipped`. The one exception is a PR that works on performance (product owner decision, 2026-10-28): there `perf` may be red when every row over its limit was already over it on main and no measurement is worse. The PR names the rows and the comparison. The label `perf` starts the perf job once when it is added, not on later pushes, so add it after the last reviewed push, and measure the comparison locally in the container.

A change of the base branch starts no CI run (#372): after it, merge the new base with `pnpm merge:main` and push before the merge, so the checks ran against it.

Agents cannot re-run jobs (403): a job that failed in a flaky step needs the next real push, never an empty commit. You find the failed step with `GET .../actions/runs/{run_id}/jobs` (`steps[].conclusion`), because the annotation only says "exit code 1" (ThomasBirkmaier/ReqSeq-archive#566).

Merge with `PUT /repos/ThomasBirkmaier/ReqSeq/pulls/{n}/merge` and `merge_method: squash`, keeping the `Implements:` trailers; GitHub deletes the branch. Use `rebase` instead only when the commits should stay revertible one by one. Never merge red, and never approve your own PR.

## After the merge

The steps below follow every merge, an auto-merge too: its `closed` event wakes the subscribed session.

`main` gets no CI run of its own after a merge, only the nightly run and a manual one (product owner decision, 2026-10-28). A red nightly run is the first work of the morning, fixed through a PR to `main` (#340). This is no licence to merge without green PR CI.

Comment on the issue the PR closes with the merge commit and, for an SR, the tests that cover each AK (`pnpm trace-check --require SR-xxx` lists them and fails on an AK without its test or record), and remove `agent:working`. For a PR that changes the spec, schemas, ADRs, agent rules, skills or CI, add one line in the milestone epic for the product owner, without waiting for an answer: the epic of the issue's milestone, or, for a PR without an issue or milestone (a bundled rules PR), the epic of the earliest open milestone. Never in a lane epic.

## Issues

The GitHub project "ReqSeq" is filled by `project-sync` from the labels, the state and the milestone, so change those, never project fields. Every open issue except the epics has exactly one of `sr`, `enabler`, `bug` and `spec-frage`, one milestone, and one of `P1` (must), `P2` (should), `P3` (could); pilot findings also get `pilot`. `agent:working` is set while an agent works on an issue and removed when it stops; `blocked` is removed when its blocker closed. A new issue meets the issue threshold in CLAUDE.md; a wish becomes a draft SR in the package of its topic (`spec-change`), and its issue is closed with a link to it once the product owner approved that close.

A merged PR closes its issue through `Closes #`. Any other close needs the product owner's explicit approval: a duplicate is closed as `duplicate` with a link to the original, one that will not be done as `not planned` with a reason. One epic per milestone (label `epic`) takes the notices for the product owner; open lane epics take none.

## Release

1. The milestone's issues are closed, and `pnpm trace-check --require <the SRs its issues complete> --report trace-<milestone>.md` passes; post the report in the milestone's epic.
2. Prepare the acceptance in the epic: what to try in the app or CLI, the `verification/` records with method Inspektion or Demonstration, and the known limitations. Count the keys three tasks take in the app and compare them with the last milestone: (1) open a given requirement, (2) all requirements of a need, (3) all requirements without a passed test; post the numbers in the epic (product owner decision, 2026-10-29, #362).
3. A PR bumps the root `version` (and runs `pnpm contracts:generate`). Then start the `Release` workflow by hand once; it publishes nothing and finds packaging regressions (ADR-0014).
4. After the product owner accepts, the product owner sets the release tag ADR-0014 names on the checked commit; agents cannot create tags. The tag starts the `Release` workflow, which writes the release notes. Never mark a milestone accepted yourself.
