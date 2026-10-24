---
name: trace-check
description: Runs and interprets the traceability check (SR -> issue -> PR -> test -> result, D-050) and posts the report to a stage epic. Use before opening a PR, when CI trace-check fails, or at the end of a stage.
---

# Trace check

The check itself is a script so CI and agents get the same answer: `node scripts/trace-check/trace-check.mjs` (`pnpm trace-check`).

- **Before a PR:** `pnpm trace-check --require SR-xxx --pr-body <file with PR body>`. Fix every error; never weaken the check.
- **In CI:** the workflow runs it with the PR body and `--enabler` for PRs labelled `enabler` or `spec-export`.
- **End of a stage:** `pnpm trace-check --stage <n> --report trace-stage-<n>.md`, then post the report as a comment in the stage epic. Errors mean the stage is not ready for acceptance.
- **What it checks:** tests name `[SR-xxx/AKn]` with an existing SR and AK; every AK of a required SR with method Test has a test; other methods have `verification/SR-xxx.md`; the PR names an SR.
- **From stage 4 on:** additionally run LogReq itself on its own repository (`logreq coverage` on `spec/` with the JUnit results of CI) and compare with the script. Differences are bugs in LogReq or in the script; open a `bug` issue.
