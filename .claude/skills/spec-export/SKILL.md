---
name: spec-export
description: Exports the LogReq specification (Needs, System Requirements, Decisions, Glossary) from the Logseq graph ReqSeq via the logseq-db MCP server into spec/ and opens a PR. Read-only in Logseq. Use when asked to export or refresh the spec, or after the spec changed in Logseq.
---

# Spec export (Logseq -> spec/)

Needs the logseq-db MCP tools (`mcp__remote-devices__logseq-db__*` in a project thread, or `logseq-db` locally). Thomas' laptop must be on, Logseq open with the HTTP API server running. **Never write to Logseq.**

1. **Check the graph.** `call_api logseq.App.getCurrentGraph` must return `logseq_db_ReqSeq`. Otherwise stop and ask.
2. **Dump raw data** into `scripts/spec-export/raw/` (git-ignored). Keep each tool result below ~80,000 characters; split calls if needed. Save each result verbatim as JSON:
   - `objects-<kind>-<n>.json`: `find_objects` with `tag` = `Need`, `System Requirement`, `Decision`, `Glossary Term`, `limit` 20, `offset` 0, 20, 40, ... until all objects are fetched.
   - `blocks-<kind>.json`: `query` with
     `[:find ?pu ?bu ?paru ?o ?t :where [?tag :block/title "<Tag>"] [?p :block/tags ?tag] [?p :block/uuid ?pu] [?b :block/page ?p] [(missing? $ ?b :logseq.property/created-from-property)] [?b :block/uuid ?bu] [?b :block/parent ?par] [?par :block/uuid ?paru] [?b :block/order ?o] [?b :block/title ?t]]`
     (`limit` 2000; split by tag if too large).
   - `pages.json`: `query` `[:find ?u ?t :where [?p :block/name] [?p :block/uuid ?u] [?p :block/title ?t]]` for link resolution.
3. **Check completeness.** The number of objects per kind must match `get_schema` (`objects` per tag). If not, fetch the missing pages.
4. **Convert.** `node scripts/spec-export/convert.mjs scripts/spec-export/raw spec`.
5. **Stages.** Keep `spec/stages.json` (`{"1": ["SR-001", ...], ...}`) in sync: new SRs get a stage following D-035 (see `sr-issues` for the rule); obsolete ones stay where they are.
6. **Review the diff.** `git diff --stat spec/`. Changed SRs are listed in the PR body (ID, title, what changed: text, acceptance criteria, status, relations).
7. **PR.** Branch `spec-export-<yyyy-mm-dd>`, commit `chore(spec): export from Logseq <date>`, label `spec-export`, enabler PR (no SR trailer). Merge per `github-pr-review-merge`; spec exports need no code review, only the completeness check.
8. **Then** run `sr-issues` so issues follow the new spec.
