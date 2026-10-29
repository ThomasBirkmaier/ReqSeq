# ReqSeq

ReqSeq is an offline requirements tool (core, CLI, API, MCP server, Electron app), built against its own specification in `spec/` until every system requirement is shown by a test. `README.md` has the layout.

## Sources of truth

- `spec/` is the specification, a ReqSeq workspace (D-064). It is German, so quote it verbatim. Read it with `node packages/cli/dist/bin.js element get SR-036 --workspace spec` after `pnpm build`. Change it only with ReqSeq, in a PR of its own: see the `spec-change` skill.
- Decisions in `spec/decision/` say what to build, and ADRs in `docs/adr/` say how. An ADR never contradicts a decision. Before architecture work, read `docs/architecture/README.md` and the ADRs of your area.
- If a system requirement is unclear, incomplete or contradicts another one, open a `spec-frage` issue with the question and your assumption, and carry the assumption in the PR. Never resolve a spec question silently in code. Do not create component requirements.

## Product rules that are easy to break

- ReqSeq never opens network connections. Tests run with the network blocked.
- ReqSeq reads Git and never writes to it (D-036).
- ReqSeq never deletes elements. It supersedes them (D-045).
- Status values are set only by people, never computed by the tool.
- Every function is available in the app, CLI, API and MCP, with the same result (D-029, SR-080). New functions start in `schemas/commands/catalog.json`, with one implementation in `packages/core/src/commands/`. No logic goes into `cli`, `api`, `mcp` or `app` (ADR-0002).
- Performance target: 50,000 requirements (N-036).

## Repository text

- Business-model topics (licensing terms, prices, revenue, customers, sponsoring, consulting, sales, marketing) never go into this repository, neither into `spec/` nor into issues, PRs, commits, ADRs or docs. A wish with a product function behind it is entered as that function only, worded for the user of the tool (product owner decision, 2026-10-28).
- No verbatim chat quotes of the product owner, no times of chat messages, no project or thread links and no names from the chat. State the origin as "product owner decision, 2026-10-28" (in German text „Entscheidung des Produktverantwortlichen, 2026-10-28“) plus a paraphrase of what was decided and why. Decision cards and chat statements are named by date and paraphrase, and issue comments by their link. The session links in attribution lines are allowed (product owner decision, 2026-10-28).
- Code, identifiers, comments, commits, PR titles, ADRs and UI texts are English (D-019). Issues quote the German spec verbatim.
- Keep PR texts, issues, plans and docs short: the substance, no filler, no repeated summary.

## Traceability (D-049, D-050)

- One issue per system requirement. Work without its own SR is labelled `enabler`.
- Branch `sr-036-short-slug` or `enabler-<issue>-short-slug`. Commits follow Conventional Commits; the body ends with `Implements: SR-036` (one line per SR) and `Refs #<issue>`. The PR title starts with the SR ID, and the body has `Closes #<issue>` and a "Verification" section.
- Each acceptance criterion with method Test has a test named `[SR-036/AK2] ...` (AK counted from 1 in the order of the spec file). Other methods get a record in `verification/SR-036.md`, which a person confirms at stage acceptance.
- `pnpm trace-check` must pass. A PR text must not name an SR ID that is not in `spec/` yet.

## Quality gates (ADR-0016)

Strict typecheck, lint with zero warnings, format, and unit test coverage of 100 % per file in every package except the adapters (`core`, `testkit`, new ones) and 80 % per adapter package (`cli`, `api`, `mcp`, app `.ts`), React `.tsx` without threshold. CLI e2e, Electron, trace-check, offline, cross-access and license and security audit run in CI, and performance at night. Never lower a threshold, switch off a lint rule or a compiler option, or add an ignore to get green. `eslint-disable`, `@ts-expect-error` and `v8 ignore` need a written reason. Check while you work with `pnpm typecheck` and `pnpm vitest run <file> --reporter=dot`; the full list before a push is in the `verify` skill.

## Traps

- GitHub has no GraphQL from cloud sessions, so `gh issue ...` and `gh pr ...` fail with 403. Use the GitHub MCP tools or `gh api repos/ThomasBirkmaier/ReqSeq/...` (REST). Sub-issues: `POST /repos/{owner}/{repo}/issues/{n}/sub_issues`.
- Do not read `schemas/generated/` or `packages/core/src/generated/` unless you debug the generator. Regenerate them with `pnpm contracts:generate`. Merge `main` into a branch with `pnpm merge:main`, which regenerates conflicting generated files.
- In `packages/core` and `packages/app`, read the README and only the parts under their `docs/` you work on; ADR-0008 and ADR-0010 are split the same way under `docs/adr/0008/` and `docs/adr/0010/`.
- Squash merges have duplicated scenario blocks in `packages/cli/test/cross-access.test.ts` (TS1117). Check it after merging `main`.
- The GitHub project "ReqSeq" is filled from the labels by `project-sync`. Change labels, never project fields.
- Keep code platform-neutral (paths via `node:path`, CRLF-safe), because PRs run on Linux only and Windows runs at night.

## How we work

- Skills, in `.claude/skills/<name>/SKILL.md` (a session that does not start in this checkout does not list them, so read the file): `verify` (check commands, Electron in the container), `spec-change` (spec, status, SR issues), `lead-run` (a stage over a long run, including the merge criteria). The review is the built-in `/code-review`, plus `/security-review` for file access, the app's process bridge or dependencies.
- For an SR issue, the SR in `spec/` wins over the issue text, and the PR says where they differ. Issues labelled `blocked`, `spec-frage` or `needs-human` wait. While an agent works on an issue, it carries `agent:working`, which the board reads.
- Plan only risky changes: an ADR or the architecture, a schema or file format, catalog design shared by several SRs, performance, security. Post a plan of about a page on the issue and have it reviewed once at effort high before building. Other issues need no plan.
- About one focused test per acceptance criterion, plus what the coverage threshold needs. Update the docs the change makes outdated (package README, block file under `packages/core/docs/`, CLI help). Implementation PRs never change `spec/`.
- Stop and ask the product owner only when you cannot continue without them, or before anything destructive or irreversible, here or on GitHub: deleting files, issues or releases (merged PR branches excepted), force-pushing or rewriting history, or changing branch protection or access.
- Opus at effort medium by default. Effort high only for risky plans and changes and for the periodic check against the spec.
- Do what the issue asks. Put pre-existing problems into the collective follow-up issue of the area. If ReqSeq behaves badly while you use it, open a `dogfooding` issue.
- Agents commit and merge on their own, also for `.claude/`, `.github/`, `schemas/`, `docs/` and this file (D-051). `main` blocks force-pushes and deletion but requires no checks. Direct commits to `main` only for trivial fixes. Merge only on green CI, after one review by a second agent whose blocking findings are fixed (`lead-run`, `merge.md`). Tell the product owner in the stage epic about PRs that change the spec, schemas, ADRs, agent rules, skills or CI, without waiting for an answer.
- Small PRs, one SR each unless SRs are inseparable. Rule, skill and doc changes that belong to no SR or code PR are bundled into one PR per half day; a pure wording fix may go straight to `main` (product owner decision, 2026-10-28, #722).
