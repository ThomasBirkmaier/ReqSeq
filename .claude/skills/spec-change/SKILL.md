---
name: spec-change
description: Reads and changes the ReqSeq specification in spec/ with the ReqSeq CLI or MCP, sets statuses only on the product owner's decision, and syncs the SR issues. Use for any spec PR or SR issue sync.
---

# Changing the spec

`spec/` is a ReqSeq workspace (D-064), and `spec/README.md` has the layout and the common commands. ReqSeq changes it, nothing else does: `node packages/cli/dist/bin.js element create|update|set-status|supersede ... --workspace spec`, or the MCP server `node packages/cli/dist/bin.js mcp --workspace spec`. Each change gets a PR of its own with label `enabler` and must pass `pnpm spec:check`. The metamodel (`spec/metamodel/`) and `spec/reqseq-workspace.yaml` have no command and are changed by hand in such a PR.

**Texts.** They are German and carry exactly what the product owner decided, with nothing added, left out or reinterpreted. They read as requirement text, not as a quote of the chat. A new wish becomes a draft element linked to its issue, and a pure bug stays an issue (product owner decision, 2026-10-26).

**Status is set by people.** An agent changes a status only to carry out a decision the product owner stated explicitly: on a decision card, in an issue comment or in the chat. The PR and the commit name that decision, an issue comment by its link, a card or a chat statement by date and paraphrase. An agent never sets an approving status on text it wrote itself, with one exception: when a decision card names the elements and the product owner picks its accepting option, that counts as the product owner's own acceptance (product owner decision, 2026-10-26). Superseding the predecessor is allowed in the same PR. Successors an agent wrote are accepted by the product owner in person or on a decision card, prompted in the stage epic or the lead thread.

**SR issues** (D-049). After a spec PR, run `pnpm build && python3 scripts/sr-issues/sr_issues.py spec` (`--dry` only prints). The script is idempotent: it creates or updates one issue per SR under its stage epic, reopens closed issues whose quoted content changed with `spec-geändert`, and closes issues of invalid SRs. Labels come from `scripts/labels.sh`. The stage of an SR is its package (`Stufe-1` to `Stufe-6`, or `Querschnitt` for SRs that apply to every function). For an SR without a package, assign one by D-035: file format, IDs, metamodel, status, version, repositories, CLI and API to 1; relations, chains, outdated references and merge request checks to 2; editor, linking, search, filters and app to 3; evidence, coverage and validation to 4; packages, baselines and variants to 5; ReqIF, confidential separation and protecting the metamodel to 6. Set it in a spec PR with `element update <SR> --workspace spec` and `set: {"packages": [{"id": "<UUID>"}]}` (`element get Stufe-<n>` gives the UUID). `Querschnitt` SRs stay open across all stages, every stage checks them, and they close at the end of stage 6. Report the counts in the PR.

The one-time migration from Logseq is described in the history of `.claude/skills/spec-export/SKILL.md` (the version before #326) and in `scripts/spec-migrate`.
