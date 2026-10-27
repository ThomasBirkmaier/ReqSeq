---
name: github-issue-draft
description: Turns a rough note about a bug, a missing enabler or a follow-up into a precise LogReq GitHub issue. Not for system requirements; SR issues come from sr-issues.
---

# Issue draft (LogReq)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

Adapted from the Capybara skill. Differences: feature issues come from the spec through `sr-issues`, so this skill is for bugs, enablers and review follow-ups only, and it creates the issue without asking for approval.

1. Read the note. If it describes new product behaviour that no SR covers, do not create a feature issue; create a `spec-frage` issue instead (LogReq only builds what the spec says).
2. Research only if needed (Opus subagent): affected files, existing issues (`gh issue list --search`), relevant SR and ADR.
3. Write the issue: context, affected areas, expected behaviour, related SRs (`Relates to: SR-xxx`), dependencies with reasons, open questions.
4. Labels: `bug` or `enabler`, the stage label, never invent labels (`gh label list`).
5. Create with `gh issue create`, assign ThomasBirkmaier, add to the stage epic as sub-issue.
