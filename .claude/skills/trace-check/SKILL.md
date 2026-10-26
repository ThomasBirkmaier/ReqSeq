---
name: trace-check
description: Runs and interprets the traceability check (SR -> issue -> PR -> test -> result, D-050) and posts the report to a stage epic. Use before opening a PR, when CI trace-check fails, or at the end of a stage.
---

# Trace check

The check itself is a script so CI and agents get the same answer: `node scripts/trace-check/trace-check.mjs` (`pnpm trace-check`). It reads the LogReq workspace in `spec/` (D-064): the system requirements by their identifier `spec-id`, their acceptance criteria, verification method and status, and the stage packages (`Stufe-<n>`, `Querschnitt`).

- **Before a PR:** `pnpm trace-check --require SR-xxx --pr-body <file with PR body>`. Fix every error; never weaken the check.
- **In CI:** the workflow runs it with the PR body and `--enabler` for PRs labelled `enabler` (or the obsolete `spec-export`). A PR body must not name an SR ID that is not in `spec/` yet.
- **End of a stage:** `pnpm trace-check --stage <n> --report trace-stage-<n>.md` (`--stage querschnitt` for the cross-cutting SRs), then post the report as a comment in the stage epic. Errors mean the stage is not ready for acceptance.
- **What it checks:** tests name `[SR-xxx/AKn]` with an existing SR and AK (a warning when the SR has an invalid status); every AK of a required SR with method test has a test; other methods have `verification/SR-xxx.md`; the PR names an SR; no spec ID is used by two SRs.
- **From stage 4 on:** additionally run LogReq itself on its own repository (`logreq evidence coverage --workspace spec` with the JUnit results of CI) and compare with the script. Differences are bugs in LogReq or in the script; open a `bug` issue.
