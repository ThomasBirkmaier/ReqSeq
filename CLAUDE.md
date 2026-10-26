# Rules for agents working on LogReq

These rules apply to every session, cloud or local. They follow from decisions D-046 to D-055 and D-064 in the spec (`spec/`); D-064 supersedes D-047 (the spec is no longer exported from Logseq).

## Sources of truth

- `spec/` is the specification, a LogReq workspace (D-064; Logseq is no longer the source). Read it with LogReq after `pnpm build`: `node packages/cli/dist/bin.js element get SR-036 --workspace spec` (also `element list`, `element search`, `trace chain`); `spec/README.md` has the layout and the common commands.
- **`spec/` is changed only with the LogReq CLI or MCP** (`node packages/cli/dist/bin.js mcp --workspace spec`), never by editing element files by hand, and only through a pull request of its own (label `enabler`, then `sr-issues`). New and changed texts are German and carry exactly the content the product owner decided (nothing added, left out or reinterpreted), written as requirement text, not as a chat quote. Status is set only by a person. An agent changes a status in `spec/` only to carry out a decision the product owner stated explicitly (decision card, issue comment or a statement in the chat, see below), names it in the PR and commit: an issue comment by its link, a decision card or a chat statement by date and paraphrase, and never sets `accepted` (or any approving status) on text it wrote on its own. Accepting on a decision card counts as the product owner's own acceptance (product owner decision on the D-064 card, 2026-10-26): when a card names the elements and the product owner picks the accepting option, the agent sets the approving status on their behalf and names the card's decision by date and paraphrase. Superseding the predecessor of such a decision is allowed in the same PR. The product owner accepts agent-written successors in person or on a decision card, prompted in the stage epic or the lead thread. LogReq has no command for the metamodel and the workspace file (`spec/metamodel/`, `spec/logreq-workspace.yaml`): they are changed by hand in such a PR. `pnpm spec:check` must pass.
- New wishes or requirements from the product owner are entered as draft elements in `spec/` through a spec PR and linked to their issue; pure bugs stay issues only (product owner decision, 2026-10-26). An explicit statement by the product owner in the project chat or a thread counts like a decision card; the PR records it as date plus a paraphrase that keeps the substantive information (what was decided and why; for example „Entscheidung des Produktverantwortlichen, 2026-10-28: Auslieferung als portables Paket statt Installer“), never as a quote.
- The spec is German. Quote it verbatim; do not translate or reinterpret it.
- Product decisions are the decisions in `spec/` (type `decision`, `spec/decision/`; "what"). Technical decisions are `docs/adr/` ("how"). An ADR never contradicts a decision.
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
- Effort of helper agents (Thomas, 2026-10-24): agents for planning, plan review, architecture questions and code review run with effort `high`; routine implementation (writing tests and code from an approved plan, fixing gate failures) runs with normal effort.
- The GitHub project "LogReq" mirrors the issues; the workflow `project-sync` derives its fields from labels. Change labels, never project fields (see `stage-run`).
- Merge with `github-pr-review-merge`. Agents commit and merge on their own everywhere, including `.claude/`, `.github/`, `schemas/`, `docs/` and this file (D-051). `main` is not protected. Direct commits to `main` are allowed for trivial fixes; everything else goes through a PR so CI and the SR trail run.
- Merge only when CI is green and the code review found nothing blocking. Never merge red.
- Tell the product owner (in the stage epic) about PRs that change the spec, schemas, ADRs, agent rules, skills or CI, but do not wait for an answer. Label `needs-human` means "the product owner must answer something", not a merge gate.
- Small PRs. One SR per PR unless SRs are inseparable; then name all of them.
- Before starting a plan, read `docs/architecture/README.md`, the ADRs it names for your area and the schemas you touch. Plans that contradict an ADR are rejected in plan review.
- New functions start as an entry in `schemas/commands/catalog.json` and one implementation in `packages/core/src/commands/`; never add logic to `cli`, `api`, `mcp` or `app` (ADR-0002).
- Local checks before a PR: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm schemas:check && pnpm contracts:check && pnpm test:coverage && pnpm trace-check` (and `pnpm build && pnpm spec:check` when `spec/` changed).

## Product rules that are easy to break

- LogReq never opens network connections (offline, closed networks). Tests run with network blocked.
- LogReq reads Git, it never writes to Git (D-036).
- LogReq never deletes elements; it supersedes them (D-045).
- Status values are only ever set by humans, never computed or set by the tool on its own.
- Every function is available via app, CLI, API and MCP, with the same result (D-029, SR-080). Add functions only through the command catalog in `packages/core`.
- Performance target: 50,000 requirements (N-036).

## Quality gates (required checks)

Typecheck (strictest settings), lint (strictTypeChecked, zero warnings), format, unit tests with 100 % coverage of product code (ADR-0016), CLI end-to-end tests, Electron tests (Playwright, xvfb on Linux), trace-check, offline test, cross-access consistency test, dependency license and security audit. Nightly: performance with generated data.

Never lower a coverage threshold, switch off a lint rule or a compiler option, or add an ignore to get green. `eslint-disable`, `@ts-expect-error` and `v8 ignore` need a written reason; the code review rejects them otherwise (ADR-0016).
