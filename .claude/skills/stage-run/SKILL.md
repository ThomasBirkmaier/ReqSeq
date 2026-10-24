---
name: stage-run
description: Drives one LogReq stage (D-035) to acceptance - orders the stage's issues, starts up to N agents in parallel on unblocked issues, collects spec questions, and reports the stage for human acceptance. Use when asked to run, continue or check a stage.
---

# Stage run

The lead engineer agent runs this skill and keeps the issues tidy. The GitHub project "LogReq" is the overview board. It is filled by the workflow `project-sync` from the labels, so manage issues **only through labels, state and sub-issues** (REST). Never edit project fields by hand; they are overwritten. Mapping: `stage:<n>`/`querschnitt` -> Stage; `sr`/`enabler`/`bug`/`spec-frage`/epic marker -> Kind; closed -> Done, `needs-human` -> Needs human, `blocked` or `spec-frage` -> Blocked, `agent:working` -> Working, else Ready -> Agent state; `thema:<slug>` -> Thema; title prefix -> SR.

Hygiene on every run: each open issue has exactly one of `sr`, `enabler`, `bug`, `spec-frage`; SR and enabler issues have a stage label or `querschnitt` and hang under their epic; `agent:working` is removed when an agent stops; stale `blocked` labels are cleared when the blocking issue closed.

1. **Preconditions.** Stage 0 (architecture, D-052) is merged before stage 1 starts. Previous stage accepted (release tag `v0.<n-1>` exists), except stage 0 and 1.
2. **Order.** Run `github-issue-dependency-analysis` for the stage if it has not run since the last spec export.
3. **Pick work.** Open issues with `stage:<n>`, without `blocked`, `spec-frage`, `needs-human`, `agent:working`, in the order from step 2. Respect parallelism: stage 0 and 1 at most 2 agents, later stages at most 5. Avoid two agents on the same package at once when the plans overlap.
4. **Start agents.** Each agent runs `github-issue-workflow` for one issue in its own session or worktree, then `github-pr-review-merge`.
5. **Watch.** On each merge, refresh blocked labels (dependency markers) and pick the next issue. Agents that stopped with `blocked` or `needs-human` are listed for the human.
6. **Spec questions.** Collect open `spec-frage` issues into one message for Thomas (question, options, recommendation), at most once a day. After answers: Thomas changes Logseq, then `spec-export` and `sr-issues`.
7. **Stage done** when all SR issues of the stage are closed and `trace-check --stage <n>` passes. Then prepare acceptance: a short list of what to try in the app or CLI, all `verification/` records with method Inspektion or Demonstration, known limitations. Thomas accepts; then tag `v0.<n>` and start the next stage.
