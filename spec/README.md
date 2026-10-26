# spec/

The LogReq specification, a LogReq workspace (D-064, enabler #326). Until stage 3 it was exported from the Logseq graph ReqSeq (D-047, superseded); the migration kept every German text, title and acceptance criterion byte for byte and every Logseq UUID as element ID.

**Change it only with LogReq** (CLI or MCP), in a pull request, German texts carrying exactly the decided content as requirement text, never as a chat quote (CLAUDE.md, "Repository content"). Status is set only by a person. See CLAUDE.md, "Sources of truth".

## Layout

- `logreq-workspace.yaml`: the workspace, one repository `spec` (this folder).
- `metamodel/spec-model.yaml`: the standard model (D-037) with the additions of this spec (D-060): property `spec-id` (meaning `identifier`), statuses per type, the glossary term.
- One Markdown file per element (D-015), named by D-056 (`SR-5a8b253c90b0.md`), in a folder named like its type key, which is where `element create` puts new elements: `need/`, `system-requirement/`, `decision/`, `glossary-term/`, `package/`.
- `package/`: one package per stage (D-035, D-040), identifiers `Stufe-1` to `Stufe-6` and `Querschnitt`. A system requirement names its stage in `packages`.

The spec IDs (`SR-036`, `D-047`, `N-001`) are the identifiers: every command takes them as references.

## Working with it

Build once (`pnpm install && pnpm build`), then from the repository root:

```sh
node packages/cli/dist/bin.js element get SR-036 --workspace spec
node packages/cli/dist/bin.js element list --workspace spec --input '{"selection":{"package":"Stufe-3"},"sort":[{"by":"spec-id"}]}'
node packages/cli/dist/bin.js element search "Abdeckung Auswahl" --workspace spec
node packages/cli/dist/bin.js trace chain SR-036 --workspace spec
node packages/cli/dist/bin.js workspace check --workspace spec
```

`pnpm logreq <command> ... --workspace spec` is the same; `pnpm spec:check` runs the check. The MCP server is `node packages/cli/dist/bin.js mcp --workspace spec`.

New elements: `element create` with `properties: {"spec-id": "<next free ID>"}` (an ID reserved for an approved draft is not free). The stage of a system requirement is its package: `element update` with `set: {"packages": [{"id": "<UUID of the package>"}]}` (`element get Stufe-3` gives the UUID).

## Known limits

- The workspace lies in a subfolder of the Git repository, so LogReq sees no Git here: versions have no date and `workspace check --changed-since` is refused (`git.unavailable`, #377).
- Mentions of spec IDs in acceptance criteria are plain text (properties are not Markdown text, #379). Mentions that form a ring (three rings of decisions and needs) stay plain text until inline `version=` no longer counts to the version (decision on #281, #378).
- The successor's own `supersedes` relation to a superseded decision is reported as `relation.target-superseded` (warning, exit code 0, #304, #382).
