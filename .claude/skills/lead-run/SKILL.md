---
name: lead-run
description: Drives one ReqSeq stage (D-035) to acceptance over a long autonomous run - orders the issues, runs up to three agents, checks progress against the spec, hands over to a fresh lead. Its merge.md has the review and merge rules for every ReqSeq PR. Use when asked to run, continue or check a stage, or to review or merge a PR.
---

# Running a stage

The lead runs a stage over hours or days and stays the one place that knows its state.

## State lives outside the thread

The state is in the milestone and its epics, the issue labels and `deps` blocks, the merged PRs, and the handover file `/mnt/project-files/stufe<n>/lead-uebergabe.md`, which lists open PRs, running agents, decisions and the next steps. A fresh lead starts by reading the epic and that file. Claim progress only from tool results (a merged PR, a green check), and name failures and skipped steps.

The GitHub project "ReqSeq" is filled by the `project-sync` workflow from the labels and state (milestone and parent epic show as built-in fields), so change those and sub-issues, never project fields. The model (product owner decision, 2026-11-01, #595):

- **Milestones are the roadmap gates**: `v0.7 Pilot ready`, `v0.8 Consolidation`, `v0.9 Own use and simplicity`, `v1.0 Trust and distribution`. They say when. Stages 1–6 ended with v0.6; from v0.7 on a milestone takes the place of a stage, and „Stage done“ below applies to it, with its version.
- **Epics are lanes across the milestones** (label `epic`, the issues as sub-issues): data, CLI/MCP, app, performance, cross-cutting SRs (#7), development, docs and security. They say what.
- **Every open issue** except the epics has exactly one of `sr`, `enabler`, `bug` and `spec-frage`, one milestone, one of `P1` (must for the milestone), `P2` (should), `P3` (could), and hangs under one epic. The `default-assignee` workflow assigns the owner to every issue and PR opened without an assignee (not to ones a workflow opens with `github.token`). SR issues stay under the epic of their spec package (the stage epics, and the Querschnitt epic #7 as the lane for cross-cutting SRs); `spec-change` gives new SR issues their milestone and priority. `querschnitt` marks cross-cutting SRs; `stage:<n>` remains only on SR issues the spec puts in a stage package. Findings from a pilot run also get `pilot`.
- **A new issue is classified when it is opened.** A wish for after 1.0 becomes an element in package „Später“ (`spec-change`) and the issue is closed with a link to it. At 1.0 no issue is open (product owner decision, 2026-10-31).

A duplicate is closed as `duplicate` with a link to the original, an issue a merged PR finished as `completed` with a link to the PR, one that will not be done as `not planned` with a reason. Remove `agent:working` when an agent stops, and remove `blocked` when its blocker closed.

## Order

Write each issue's dependencies between `<!-- deps:start -->` and `<!-- deps:end -->`, either hard (`Blocked by #x`, which also gets the label `blocked`) or soft (`After #x`), each with a reason. An issue never depends on a later stage. Open a `spec-frage` or `needs-human` issue for contradictions in architecture, data model or scope, and resolve mechanical ones yourself. Order the issues topologically, and among equals take first the issue that unblocks the most others, then the smallest. Put the order as a table in the epic, with positions that hang on an open question marked provisional. Redo it when the spec changed.

## Spec check before the plan

Before agents take the first issues of a stage, one agent at effort high checks the stage's needs and SRs: each unambiguous, singular, consistent with the glossary and the other SRs, covering its needs, and free of solutions no decision carries. For each AK it checks one behaviour, the access that shows it (app, CLI, API, MCP), the trigger as a command or event, a concrete example where the meaning depends on values, the edge cases, and the test level (core, CLI e2e, app e2e). Assumptions confirmed earlier in issues count as open until they are in the spec. Its report marks what it could not confirm and says where it looked. Open points become questions with a recommendation, which the lead asks in one round as decision cards. The answers go into the AK text through one spec PR (`spec-change`), never only into an issue. The round ends with the product owner approving the stage's elements; only then do plans and implementation start (#389).

## Agents

Run at most three agents at once, reviewers included (budget rule, product owner decision, 2026-10-28). Each takes one unblocked issue without `agent:working` to a PR. Review and merge follow `merge.md` in this folder. All agents are Opus at effort medium. Keep two agents off the same package when their changes overlap. Keep working while agents run, and keep their reports short (PR, state, findings, follow-ups). For an AK with visible behaviour, the PR shows the evidence: the CLI output, or a light-theme screenshot from the PR's Electron test. A PR writes no demo file. When a sequence (a group of issues worked one after another, named in the epic's order table) is merged, show the product owner its visible behaviour in one short demo from that evidence. Side questions that do not belong to the stage go to the coordinator, and agents that stopped with `blocked` or `needs-human` are listed for the product owner. There is no fixed CI round. Look at CI only when a PR waits unusually long for it (about 30 minutes) or turns red again and again, and then report the cause to the coordinator with a fix (product owner decision, 2026-10-28).

## Checks against the spec

After each merged sequence and once before the acceptance, a fresh agent compares the closed SR issues of the stage with their AKs and the spec text, and runs `pnpm trace-check --stage <n>`. Gaps become issues. The report marks what the agent could not confirm and says where it looked. Collect the open `spec-frage` issues into one message for the product owner at most once a day, and enter the answers with `spec-change`.

## Handover

Hand over to a fresh lead thread at natural breaks (the end of a stage, after a quality gate, before the work moves to another thread or container), in the evening before the night's work, and once a day as a safety net. Save the state to the handover file and to project memory (`reqseq-stufe<n>`), then ask the coordinator for the new thread. A long context alone is no reason to stop, because the session summarizes it.

## Stage done

A stage is done when all its SR issues are closed and `pnpm trace-check --stage <n> --report trace-stage-<n>.md` passes; post the report in the stage epic. Then:

1. A PR adds `<n>` to `COMPLETED_STAGES` in `packages/core/src/commands/registry.test.ts`.
2. Prepare the acceptance: what to try in the app or CLI, the `verification/` records with method Inspektion or Demonstration, and the known limitations.
3. Stage 3 also passes gate G2a (N-032): the product owner accepts the look and feel of the app personally (simple, minimalist, aesthetic, Logseq as the benchmark; there is no SR for it). Prepare screenshots and a short demo, and label the epic `needs-human`. Never mark it accepted yourself.
4. A PR bumps the root `version` to `0.<n>.0` (and runs `pnpm contracts:generate`). Then start the `Release` workflow by hand (ADR-0014).
5. After the product owner accepts, tag `v0.<n>` through the REST API with the session's token, because a tag made with a workflow's `GITHUB_TOKEN` starts no workflow. Then start the next stage.

Stage 1 needs stage 0 merged. Every later stage needs the release tag `v0.<n-1>` of the stage before.
