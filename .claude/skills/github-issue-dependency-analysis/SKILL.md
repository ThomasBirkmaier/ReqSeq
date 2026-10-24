---
name: github-issue-dependency-analysis
description: Analyses all open LogReq issues of a stage for dependencies and contradictions, writes the dependencies and a processing order into each issue, and raises only architecture or scope contradictions to the human. Use before stage-run distributes work, or when asked to order issues.
---

# Issue dependency analysis (LogReq)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

Adapted from the Capybara skill. Differences: the stage from D-035 is a hard constraint, and only contradictions that touch architecture or scope go to the human; everything else is decided and documented.

1. **Fetch** all open issues with `gh issue list --state open --limit 500 --json number,title,body,labels`. Back up bodies to `issue-backup-<date>.json` (not committed).
2. **Understand** each issue: SR, stage label, affected packages (from plan comments if present, otherwise from SR and architecture).
3. **Dependencies.** Explicit first: `Derives from`/`Based on` of the SR, links in bodies, schema dependencies. Then semantic: issue A needs a command, file format or index that B builds. Hard (`Blocked by #x`) vs soft (`After #x`). An issue never depends on a later stage; if it seems to, that is a contradiction.
4. **Contradictions and cycles.** Mechanical ones you resolve and document. Architecture, data model or scope conflicts: open a `spec-frage` issue (or `needs-human` for architecture) with options and a recommendation.
5. **Order.** Topological order within the stage; ties broken by: unblocks most others, then smallest. Mark positions depending on an open question as provisional.
6. **Write back** idempotently between the markers `<!-- deps:start -->` and `<!-- deps:end -->` in each body: hard and soft dependencies, contradictions, position. Set label `blocked` on issues with open hard dependencies, remove it where none are left.
7. **Output** a table in the stage epic: position, issue, title, reason.
