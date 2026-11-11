# ReqSeq

ReqSeq is an offline requirements tool (core, CLI, API, MCP server, Electron app), built against its own specification in `spec/` until every system requirement is shown by a test. `README.md` has the layout, and `docs/process.md` shows the way of working from need to release.

This file is the starting point. It holds the rules that apply to every change, and says where the rest is.

## Before you start

| Before … | read |
| --- | --- |
| a change to `spec/` | skill `spec-change` |
| planning a new or changed requirement, or fixing a bug against an AK | skill `spec-change` (Dependency check) and Issues below |
| every push | skill `verify` |
| opening, reviewing or merging a PR, or a release | skill `merge` |
| architecture work | `docs/architecture/README.md` and the ADRs of your area |
| work in `packages/core` or `packages/app` | its README and only the part under its `docs/` you work on (ADR-0008 and ADR-0010 are split the same way) |

Skills are in `.claude/skills/<name>/SKILL.md`. A session that starts outside this checkout may list them as `reqseq:<name>`, or not at all; then read the file. The review is the built-in `/code-review`, plus `/security-review` for file access, the app's process bridge or dependencies.

## Sources of truth

- `spec/` is the specification, a ReqSeq workspace. It is German; where a quote is allowed (Repository text), quote it verbatim and do not translate. Read it with `node packages/cli/dist/bin.js element get SR-036 --workspace spec` after `pnpm build`. Change elements only with ReqSeq, in a PR of its own; the metamodel, the workspace file and `spec/README.md` are edited by hand (`spec-change`).
- Decisions in `spec/decision/` say what to build, and ADRs in `docs/adr/` say how. An ADR never contradicts a decision.
- If a system requirement is unclear, incomplete or contradicts another one, open a `question` issue with the question and your assumption, and carry the assumption in the PR. When the product owner answers, the answer goes into the spec (`spec-change`), and the PR that closes the question names the element (product owner decision, 2026-11-11). Never resolve a spec question silently in code. Do not create component requirements; they come with the architecture (D-059).
- The SR in `spec/` wins over an issue text; the PR says where they differ.

## Product rules that are easy to break

- ReqSeq never opens network connections (SR-078). Tests run with the network blocked.
- ReqSeq reads Git and never writes to it (D-036).
- ReqSeq never deletes elements. It supersedes them (D-045).
- The status of an element is set only by people; the tool never changes it (D-030). The verification status is computed (SR-031).
- Every function is available in the app, CLI, API and MCP, with the same result (D-029, SR-080). New functions start in `schemas/commands/<name>.json`, listed in `catalog.header.json`, with one implementation in `packages/core/src/commands/`. No logic goes into `cli`, `api`, `mcp` or `app` (ADR-0002).
- Performance: the thresholds an AK names hold for 50,000 requirements (N-036). Other rows of the nightly record are for comparison and start no work (product owner decision, 2026-11-05).
- No backward compatibility for formats, files and outputs, except for stored user data since v0.7.2 (versions, evidence records, baselines). Ask the product owner before writing compatibility code (product owner decision, 2026-10-29 and 2026-11-05).

## Repository text

- Everything in the repository and on GitHub is English: code, comments, commits, PRs, issues, ADRs, docs and UI texts (UI: D-019; everything else: product owner decision, 2026-11-07). Exceptions: `spec/`, proper names, and a verbatim quote of the German spec where a question depends on its wording.
- Business-model topics (licensing terms, prices, revenue, customers, sponsoring, consulting, sales, marketing) never go into this repository, neither into `spec/` nor into issues, PRs, commits, ADRs or docs. A wish with a product function behind it is entered as that function only, worded for the user of the tool (product owner decision, 2026-10-28). The exception is the license itself: `LICENSE` and the License section of the README hold the terms the product owner gives, word for word, without the reasons or the model behind them (product owner decision, 2026-11-11).
- No verbatim chat quotes of the product owner, no times of chat messages, no project or thread links and no names from the chat. State the origin as "product owner decision, 2026-10-28" (in German text „Entscheidung des Produktverantwortlichen, 2026-10-28“) plus a paraphrase of what was decided and why; name decision cards and chat statements by date and paraphrase, and issue comments by their link. Allowed are the session links in attribution lines and the attribution line the platform requires at the top of a PR body, "Requested by … · project thread" with its link; reviewers do not flag them (product owner decision, 2026-10-28 and 2026-10-29).
- A bare `#N` is an issue or PR of this repository. A reference to an issue or PR of the repository before the move (2026-10-29 06:00 UTC; this repository starts at #1 then) carries its name, `ThomasBirkmaier/ReqSeq-archive#N` (#338).
- User docs (`docs/guide/`, and the schema and metamodel descriptions the reference is generated from) state only what the spec (glossary, needs, SRs, decisions), an ADR or the code says. A term means what its glossary entry says; take no framing from an issue title or a plausible guess. An SR, decision or ADR cited in the docs says what it is cited for. A statement without such a source is left out, or the gap becomes a `question` issue; where the code contradicts the spec, the docs follow neither until a `bug` or `question` issue settles it (product owner decision, 2026-11-09).
- Keep PR texts, issues, plans and docs short: the substance, no filler, no repeated summary.

## Issues

The way of working of 2026-11-07 (product owner decision; picture in `docs/process.md`):

- **One issue is one task that one PR finishes.** A task that needs several PRs becomes an `epic` with sub-issues (`POST /repos/{owner}/{repo}/issues/{n}/sub_issues`); the epic closes when its sub-issues are closed: the PR of the last sub-issue carries `Closes #<epic>` as well.
- **Open an issue only** for a bug shown by a reproduction or a failing test (also a red CI job the PR did not cause, before its re-run: `merge`), an AK of an SR that is not met, a step from the pre-study of a planned SR that the product owner chose to become an issue, a question for the product owner, or a task the product owner asks for. Anything smaller is fixed in the same PR, or noted in its description. An idea becomes a draft SR in the package of its topic, not an issue (`spec-change` says when). One problem per issue. Nothing creates issues for SRs in bulk.
- **Title:** what is different afterwards (feature, task) or what is wrong (bug), in the user's words, with a distinctive keyword first, about 70 characters, no prefix. A question about an AK: `SR-149 AK1: order of package groups?`
- **Body:** it opens with 1–3 sentences without jargon on what a user notices and why it matters, understandable without other issues or threads. An issue that implements AKs, or a bug that breaks one, has the line `SR: SR-112 (AK1, AK2)` instead of a copy of the AK.
- **Labels:** exactly one type (`bug`, `feature`, `task`, `question`), one area where the main change is (`core`, `cli`, `api`, `mcp`, `app`, `spec`, `dev`), and one priority (`P1` must, `P2` should, `P3` could). `needs-human` while the issue waits for the product owner, `epic` for a cut task, `agent:working` while an agent works on it. The origin (pilot, dogfooding, security review) goes into the text, not into a label. `scripts/labels.sh` is the list; `project-sync` fills the board from the labels, so change labels, never project fields.
- **Milestone:** one per version x.y; its description states its goal and exit criterion. Every open issue has one. A step of an open epic becomes its sub-issue and has the epic's milestone. A bug or flake gets the lowest open version; any other issue the open version whose goal it serves, else the lowest open one. The product owner moves issues between milestones, and opens the next milestone with its goal and exit criterion when a version x.y is released (product owner decision, 2026-11-11).
- **Closing:** the merged PR closes its issue with `Closes #`. A close without a PR (duplicate, not planned) needs the product owner's explicit approval and a reason.
- Issues labelled `needs-human` wait. **Before the first change for an issue, set `agent:working` on it** (`gh api -X POST repos/ThomasBirkmaier/ReqSeq/issues/<n>/labels -f 'labels[]=agent:working'`): the board shows an issue "In Progress" only through this label. The workflow `issue-working` also sets it on each open issue a PR closes (`Closes #`) and removes it when the PR is closed. Remove it yourself when you stop without a PR.
- **Bugs take the short path:** a bug without an SR is fixed without a dependency check. A bug against an AK first lists the SR's parents and children (`trace related parents --refs <SR>` and `trace related children --refs <SR>`) and runs one `element search` per term of the AK, then is fixed. A fix that needs an interpretation of the AK wording becomes a `question` (`docs/process.md`).
- If ReqSeq behaves badly while you use it and you can reproduce it, open a `bug` issue with the reproduction and say in the text that it came from own use.

## Traceability

- Commits follow Conventional Commits; the body ends with `Implements: SR-036` (one line per SR, taken from the issue's SR line) and `Refs #<issue>`. The PR body has `Closes #<issue>` and a "Verification" section. The PR title starts with the SR ID only when the PR completes the SR, and its author runs `pnpm trace-check --require SR-036` first; a PR for one task of an SR names the SR in its body only.
- Each acceptance criterion with method Test has a test named `[SR-036/AK2] ...` (AK counted from 1 in the order of the spec file). Other methods get a record in `verification/SR-036.md`, which a person confirms at milestone acceptance. ReqSeq computes the verification status from these test names, the CI evidence and the records, not from issues or labels.
- `pnpm trace-check` must pass; it reads no PR text. A PR text must not name an SR ID that is not in `spec/` yet.
- `spec/evidence/ci/` holds the test evidence of the spec, written only by `evidence.yml` through its own pull requests (`verification/README.md`). They merge themselves without an agent review; agents leave them alone and never write there by hand.

## Quality gates (ADR-0016)

Strict typecheck, lint with zero warnings, format, and unit test coverage of 100 % per file in every package except the adapters (`core`, `testkit`, new ones) and 80 % per adapter package (`cli`, `api`, `mcp`, app `.ts`), React `.tsx` without threshold. CLI e2e, Electron, trace-check, offline, cross-access and license and security audit run in CI, and performance at night. Never lower a threshold, switch off a lint rule or a compiler option, or add an ignore to get green. `eslint-disable`, `@ts-expect-error` and `v8 ignore` need a written reason. Check while you work with `pnpm typecheck` and `pnpm vitest run <file> --reporter=dot`; the full list before a push is in `verify`.

## Traps

- GitHub has no GraphQL from cloud sessions, so `gh issue ...` and `gh pr ...` fail with 403, and a hook stops them there. Use the GitHub MCP tools or `gh api repos/ThomasBirkmaier/ReqSeq/...` (REST).
- Hooks in `.claude/settings.json` (`scripts/hooks/`) block hand edits of tool-written files and run Prettier on each edited file. `.mcp.json` starts the ReqSeq MCP from `packages/cli/dist` of the checkout the session starts in (needs `pnpm build` there) and context7 for library docs.
- Do not read `schemas/generated/` or `packages/core/src/generated/` unless you debug the generator. Regenerate them with `pnpm contracts:generate`. Merge `main` into a branch with `pnpm merge:main` (`merge`).
- Keep code platform-neutral (paths via `node:path`, CRLF-safe), because CI checks every ready PR and main on Linux, macOS and Windows.

## How we work

- Plan only risky changes: an ADR or the architecture, a schema or file format, catalog design shared by several SRs, performance, security, and a spec change that changes a decision or a glossary term or whose `trace affected` returns any element. Post a plan of about a page on the issue (for a spec change without one, in the thread) and have it reviewed once at effort high before building; for a risky spec change the plan is a concept with its edge cases, reviewed by an independent second agent before it goes on a decision card (`spec-change`).
- About one focused test per acceptance criterion, plus what the coverage threshold needs. Update the docs the change makes outdated (package README, block file under `packages/core/docs/`, CLI help). Implementation PRs never change `spec/`.
- Opus at effort medium by default; implementing agents run as `implementer` (`.claude/agents/`) where the session lists it. Opus runs at effort high only for the review of a risky plan or concept, the code review of a risky change, and the check of review findings against code and tests (`docs/process.md`; product owner decision, 2026-11-11). Fable runs only as the read-only agent `fable-reviewer`, started by an Opus thread, in two standing cases: the reading step of a spec review the product owner asks for, and the review of the concept of a risky spec change (`spec-change`); and for another reading task when the product owner asks for it, with the date of that request in the agent's prompt (product owner decision, 2026-11-11). Threads use it for the two standing cases without asking; the product owner names Opus in the task to change that (product owner decision, 2026-11-10).
- Stop and ask the product owner only when you cannot continue without them, or before a step that cannot be undone, here or on GitHub: deleting an issue, a release, an unmerged branch, or a file outside version control that you did not write; force-pushing or rewriting history; changing branch protection or access. Removing a tracked file in a pull request is an ordinary change. Reading, read-only GitHub calls, the checks of `verify`, retries, re-running failed jobs, `agent:working`, comments on your task's issues and PRs, and the steps of `merge` need no approval (product owner decision, 2026-11-11). Open points of a wish for the spec follow `spec-change`: ask first.
- Agents commit and merge on their own, also for `.claude/`, `.github/`, `schemas/`, `docs/` and this file. `main` requires checks, so every change goes through a pull request: small, one SR each unless SRs are inseparable, branched from `main`, merged on green CI after one review by a second agent whose blocking findings are fixed (`merge`). Every PR is assigned to the product owner (`default-assignee`), which is how they follow it; PRs are opened under their account, so GitHub allows no review request. Rule, skill and doc changes that belong to no SR or code PR are bundled into one PR per half day (product owner decision, 2026-10-28, ThomasBirkmaier/ReqSeq-archive#722).
