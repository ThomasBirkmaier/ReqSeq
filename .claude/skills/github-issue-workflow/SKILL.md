---
name: github-issue-workflow
description: Implements one LogReq GitHub issue (an SR issue or an enabler) end to end and autonomously - plan by Opus, plan review by a second Opus agent, tests from acceptance criteria, implementation by Opus, quality gates, Opus code review, PR. Use when asked to work on, implement or close an issue, or when stage-run hands over an issue.
---

# Issue workflow (LogReq, autonomous)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

Adapted from the Capybara skill of the same name. Difference: there is no human approval of the plan. A second Opus agent reviews the plan instead. Read `CLAUDE.md` first; its rules win over this skill.

## Steps

1. **Load the issue.** `gh issue view <n> --json number,title,body,labels`. For an SR issue, also read the SR in the spec: `node packages/cli/dist/bin.js element get SR-xxx --workspace spec` (after `pnpm build`), or the file it names (the spec wins if the issue body differs; then note it in the PR). Skip issues labelled `blocked`, `spec-frage` or `needs-human` unless told otherwise.
2. **Claim it.** Add label `agent:working`, comment "Started by agent" with the session link. Branch `sr-xxx-<slug>` (or `enabler-<n>-<slug>`) from the latest `main`.
3. **Plan (Opus subagent, effort high; `xhigh` for SR-111 and SR-117).** Read the issue, the SR, the decisions in `Based on`, relevant ADRs and schemas, and the affected code. Produce: affected packages and files, a test list mapping each acceptance criterion `AKn` to one or more tests, implementation steps, risks, and explicit assumptions. Spec questions go to step 3a.
   - 3a. **Spec question.** If the SR cannot be implemented without guessing something that changes visible behaviour: open an issue with label `spec-frage` (question, options, recommended option), link it, and either continue with the recommended option written as an assumption in the PR, or stop and set label `blocked` if the guess would be expensive to undo.
4. **Plan review (second Opus subagent, effort high; `xhigh` for SR-111 and SR-117).** Checks the plan against SR text, acceptance criteria, decisions, ADRs, `CLAUDE.md`. Verdict: approve, or a list of required changes. Revise until approved (max 3 rounds; then label `needs-human`, post the open points for the product owner, and stop). Post the final plan as an issue comment.
5. **Tests first (Opus subagent, normal effort).** Write the tests from the test list. Names start with `[SR-xxx/AKn]`. They must fail for the right reason before implementation.
6. **Implementation (Opus subagent, normal effort).** Follow the approved plan; no re-analysis. New functions go through the command catalog in `packages/core`, so CLI, API, MCP and app get them.
7. **Quality gates.** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:coverage && pnpm trace-check`, plus e2e if touched. Zero warnings, 100 % coverage of product code (ADR-0016); write the missing tests instead of ignoring code. Non-trivial failures go back to step 6, not quick patches.
8. **Code review (Opus subagent, effort high; `xhigh` for SR-111 and SR-117).** Round 1: diff against `main`, plan, SR. Later rounds: only the diff since the last review; the open findings are resolved and the new code gets the full checks of round 1 (#392). Solved for real? Matches plan? Edge cases? Product rules in `CLAUDE.md` (offline, read-only Git, no delete, all accesses)? Any `eslint-disable`, `@ts-expect-error` or `v8 ignore` without a valid reason is a blocking finding, as is any weakened gate (ADR-0016). Findings go back to step 6 (Opus, normal effort), then 7 and 8 again. Record the number of rounds.
9. **Docs.** Update docs that became outdated (README of the package, in `packages/core` the block file under `docs/`, CLI help, schemas if the plan said so). Changing schemas or ADRs is allowed; mention it in the PR and the stage epic.
10. **Verification records.** For methods other than Test, write or update `verification/SR-xxx.md`.
11. **Commit.** Conventional Commits, English. Body ends with `Implements: SR-xxx` and `Refs #<n>`.
12. **PR.** Title `SR-xxx: <short English title>`. Body from `.github/pull_request_template.md`: summary, `Closes #<n>`, verification (which tests cover which AK), assumptions, review rounds. Remove `agent:working`. Then hand over to `github-pr-review-merge`.

## Principles

- Opus plans, implements and reviews (product owner decision, 2026-10-27). Do not skip the reviews because the change looks obvious.
- Never change `spec/` in an implementation PR; a spec change is its own PR made with LogReq (CLAUDE.md). Never set a status in spec or evidence files.
- Prefer stopping with a clear `spec-frage` over building on a guess that changes behaviour.
