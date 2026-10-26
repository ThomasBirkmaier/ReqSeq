---
name: sr-issues
description: Creates and updates one GitHub issue per system requirement from the LogReq workspace in spec/ (D-049), with stage epics as parent issues, and flags implemented SRs whose spec changed. Idempotent. Use after a PR that changed the spec, or when asked to create or sync SR issues.
---

# SR issues (spec/ -> GitHub issues)

Steps 2 and 4 are scripted: `pnpm build && python3 scripts/sr-issues/sr_issues.py spec` (`--dry` prints only). It reads the spec with LogReq itself (`logreq element list --json`), is idempotent and finds issues by their body markers.

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

1. **Labels** exist (create once with `scripts/labels.sh`): `sr`, `enabler`, `bug`, `stage:0` to `stage:6`, `thema:<slug>` for the ten topics, `spec-frage`, `spec-geändert`, `blocked`, `agent:working`, `needs-human`, `dogfooding`.
2. **Stage epics.** One issue per stage titled `Stage <n>: <name from D-035>` with label `stage:<n>`. Create if missing.
3. **Stage of an SR** is its package in `spec/` (D-040): the packages `Stufe-1` to `Stufe-6` and `Querschnitt` (identifiers; `logreq element get Stufe-3 --workspace spec` gives the UUID). Every SR names exactly one in its property `packages`. For an SR without one, assign by D-035: everything that fixes the file format, IDs, metamodel, status, version (Fassung), one or many repositories, CLI and API goes to stage 1; relations, chains, outdated references, affected elements, merge request check to 2; editor, linking, search, filters, app to 3; evidence records, coverage, indirect evidence, validation to 4; packages, baselines, variants to 5; ReqIF, confidential separation, protecting the metamodel to 6. Set it with LogReq in a spec PR (`element update <SR> --workspace spec` with `set: {"packages": [{"id": "<package UUID>"}]}`). Cross-cutting SRs that apply to every function (all accesses, offline, performance, keyboard, English UI and the like) get the package `Querschnitt` and the label `querschnitt` instead of one stage: they stay open across all stages, every stage checks them, and they close at the end of stage 6.
4. **For each SR** (skip one with an invalid status such as `obsolete`; close its open issue with a comment instead):
   - Find the issue by the marker `<!-- sr:SR-xxx -->` in the body.
   - Title `SR-xxx <German title>`. Body (the text with the `logreq:` link markup taken out, so it quotes the spec verbatim):
     ```
     <!-- sr:SR-xxx -->
     **SR-xxx** · UUID `<uuid>` · Stage <n> · Thema <topic> · Nachweismethode <method>
     Derives from: N-..., Based on: D-...

     <spec text verbatim>

     **Akzeptanzkriterien**
     - [ ] AK1: <verbatim>
     - [ ] AK2: ...

     Spec: `spec/<file>` (`logreq element get SR-xxx --workspace spec`)

     <!-- spec-content:<sha256 of text, acceptance criteria, method and requirement type> -->
     <!-- deps:start --><!-- deps:end -->
     ```
   - Create, or update only the part above `deps:start` (keep dependency analysis and comments).
   - Labels `sr`, `stage:<n>`, `thema:<slug>`. Add as sub-issue of the stage epic.
   - If the issue is closed and the quoted content changed: reopen it, add `spec-geändert`, comment what changed. Issues from before the migration (#326) carry the old marker `spec-hash`; for them the quoted part is compared.
5. **Report** counts (created, updated, reopened, closed) in the PR or thread.
