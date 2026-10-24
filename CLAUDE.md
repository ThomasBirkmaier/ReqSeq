# Rules for agents working on LogReq

These rules apply to every session, cloud or local. They follow from decisions D-046 to D-055 in the spec (`spec/decisions/`).

## Sources of truth

- `spec/` is the specification. It is exported from the Logseq graph ReqSeq (D-047). **Never edit `spec/` by hand.** Only the `spec-export` skill changes it, through its own pull request.
- The spec is German. Quote it verbatim; do not translate or reinterpret it.
- Product decisions are `spec/decisions/D-*.md` ("what"). Technical decisions are `docs/adr/` ("how"). An ADR never contradicts a decision.
- If a system requirement is unclear, incomplete or contradicts another one: open an issue with label `spec-frage`, state the question and your assumption, and continue with other work or with the assumption clearly written in the PR. Never resolve a spec question silently in code.
- Component requirements are not used for now. Do not create them.

## Traceability (D-049, D-050)

- One issue per system requirement (`SR-xxx`). Enabler work without its own SR uses label `enabler`.
- Branch: `sr-036-short-slug` or `enabler-<issue>-short-slug`.
- Commit body trailer: `Implements: SR-036` (one line per SR) and `Refs #<issue>`.
- PR title starts with the SR ID; PR body contains `Closes #<issue>` and the section "Verification".
- Every acceptance criterion with verification method `Test` has at least one automated test whose name starts with `[SR-036/AK2]` (AK = Akzeptanzkriterium, counted from 1 in the order of the spec file).
- Analysis, inspection and demonstration: write a record in `verification/SR-036.md` (what was checked, how, result). A human confirms it at stage acceptance. Agents never mark anything as approved.
- `pnpm trace-check` must pass before you open a PR.

## GitHub access

GraphQL is not available from Claude Code cloud sessions. `gh issue ...` and `gh pr ...` subcommands use GraphQL and fail with HTTP 403. Use the GitHub MCP tools (`mcp__github__*`) or the REST API via `gh api repos/ThomasBirkmaier/logreq/...` instead. Auto-merge: `PUT /repos/{owner}/{repo}/pulls/{n}/ccr/auto_merge`. Sub-issues: `POST /repos/{owner}/{repo}/issues/{n}/sub_issues`. The `gh ...` lines in the skills describe the intent; translate them.

## Language

- Code, identifiers, comments, commit messages, PR titles, ADRs, UI texts: English (D-019).
- Issues quote the German spec text verbatim; the rest of an issue may be English or German.

## Workflow

- Implement an issue with the `github-issue-workflow` skill: plan (Opus), plan review (second Opus agent), tests from acceptance criteria first, implementation (Sonnet), quality gates, code review (Opus), PR.
- Merge with `github-pr-review-merge`. You may merge your own PR when all required checks are green and the review found nothing blocking (D-051).
- **Exception:** PRs that change `schemas/`, `docs/adr/`, `docs/architecture/`, `CLAUDE.md`, `.claude/`, `.github/` or add a dependency with a non-permissive license get label `needs-human`. Only Thomas merges those.
- Small PRs. One SR per PR unless SRs are inseparable; then name all of them.
- Before starting a plan, read the relevant ADRs and schemas.

## Product rules that are easy to break

- LogReq never opens network connections (offline, closed networks). Tests run with network blocked.
- LogReq reads Git, it never writes to Git (D-036).
- LogReq never deletes elements; it supersedes them (D-045).
- Status values are only ever set by humans, never computed or set by the tool on its own.
- Every function is available via app, CLI, API and MCP, with the same result (D-029, SR-080). Add functions only through the command catalog in `packages/core`.
- Performance target: 50,000 requirements (N-036).

## Quality gates (required checks)

Typecheck (strict), lint, format, unit tests, CLI end-to-end tests, Electron tests (Playwright, xvfb on Linux), trace-check, offline test, cross-access consistency test, dependency license and security audit. Nightly: performance with generated data.
