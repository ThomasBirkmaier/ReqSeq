---
name: sr-issues
description: Creates and updates one GitHub issue per system requirement from spec/ (D-049), with stage epics as parent issues, and flags implemented SRs whose spec changed. Idempotent. Use after spec-export, or when asked to create or sync SR issues.
---

# SR issues (spec/ -> GitHub issues)

> GitHub: use the GitHub MCP tools or `gh api` (REST). `gh issue`/`gh pr` need GraphQL, which cloud sessions cannot reach (see CLAUDE.md).

1. **Labels** exist (create once with `scripts/labels.sh`): `sr`, `enabler`, `bug`, `stage:0` to `stage:6`, `thema:<slug>` for the ten topics, `spec-frage`, `spec-geändert`, `blocked`, `agent:working`, `needs-human`, `spec-export`.
2. **Stage epics.** One issue per stage titled `Stage <n>: <name from D-035>` with label `stage:<n>`. Create if missing.
3. **Stage of an SR** from `spec/stages.json`. For SRs without a stage, assign by D-035: everything that fixes the file format, IDs, metamodel, status, version (Fassung), one or many repositories, CLI and API goes to stage 1; relations, chains, outdated references, affected elements, merge request check to 2; editor, linking, search, filters, app to 3; evidence records, coverage, indirect evidence, validation to 4; packages, baselines, variants to 5; ReqIF, confidential separation, protecting the metamodel to 6. Write the result back to `spec/stages.json` in a PR. Cross-cutting SRs that apply to every function (all accesses, offline, performance, keyboard, English UI and the like) get label `querschnitt` instead of one stage: they stay open across all stages, every stage checks them, and they close at the end of stage 6. In `spec/stages.json` they are listed under the key `querschnitt`.
4. **For each SR** (skip `Obsolete`; close its open issue with a comment instead):
   - Find the issue by the marker `<!-- sr:SR-xxx -->` in the body (`gh issue list --search "SR-xxx in:title"`, then check the marker).
   - Title `SR-xxx <German title>`. Body:
     ```
     <!-- sr:SR-xxx -->
     **SR-xxx** · UUID `<uuid>` · Stage <n> · Thema <thema> · Nachweismethode <method>
     Derives from: N-..., Based on: D-...

     <spec text verbatim>

     **Akzeptanzkriterien**
     - [ ] AK1: <verbatim>
     - [ ] AK2: ...

     <!-- spec-hash:<sha256 of the SR file> -->
     <!-- deps:start --><!-- deps:end -->
     ```
   - Create, or update only the part above `deps:start` (keep dependency analysis and comments).
   - Labels `sr`, `stage:<n>`, `thema:<slug>`. Add as sub-issue of the stage epic.
   - If the issue is closed and the spec hash changed: reopen it, add `spec-geändert`, comment what changed.
5. **Report** counts (created, updated, reopened, closed) in the PR or thread.
