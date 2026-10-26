---
name: spec-export
description: Obsolete since #326 (D-064). The spec is no longer exported from Logseq; it is the LogReq workspace in spec/ and is changed with the LogReq CLI or MCP. Use only to look up how to change the spec now, or to redo the one-time migration from a fresh Logseq export.
---

# Spec export (obsolete)

Since enabler #326, `spec/` is a LogReq workspace and Logseq is no longer the source (D-064 supersedes D-047). Nothing exports into `spec/` any more.

**Changing the spec now** (CLAUDE.md, "Sources of truth"): with LogReq, from the repository root after `pnpm build`, for example `node packages/cli/dist/bin.js element update SR-036 --workspace spec --input @change.json`, or through the MCP server `node packages/cli/dist/bin.js mcp --workspace spec`. One PR per spec change, German texts carrying exactly the decided content (nothing added, left out or reinterpreted), written as requirement text, not as a chat quote, label `enabler`. An agent changes a status in `spec/` only to carry out a decision the product owner stated explicitly (decision card, issue comment or a statement in the chat), names it in the PR and commit (an issue comment by its link; a decision card or a chat statement by date and paraphrase, without chat quotes, message times or thread links, CLAUDE.md "Repository content"), and never sets `accepted` (or any approving status) on text it wrote. Superseding the predecessor of such a decision is allowed in the same PR. The product owner accepts agent-written successors in person, prompted in the stage epic. Then run `sr-issues`. `spec/README.md` has the layout and the common commands.

**Redoing the migration** (only before the spec has changed in LogReq, or when the product owner asks for it): this needs the product owner's laptop with Logseq and the logseq-db MCP server, read-only in Logseq.

1. Dump the raw data into `scripts/spec-export/raw/` (git-ignored) as the history of this file describes (`git log -p .claude/skills/spec-export/SKILL.md`, the version before #326).
2. `node scripts/spec-export/convert.mjs scripts/spec-export/raw <empty folder>/export` writes the preliminary format; copy `stages.json` from `git show decba1a:spec/stages.json` and update it.
3. `pnpm build && node scripts/spec-migrate/convert.mjs <empty folder>/export <empty folder>/spec` converts it (see the comment at the top of that script).
4. Replace the element files in `spec/` with the result in a PR, and redo every change made in LogReq since the migration (D-064 and the supersede of D-047: see the PR of #326).
