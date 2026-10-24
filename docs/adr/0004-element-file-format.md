# ADR-0004: Element file format

Status: Proposed · Based on: D-012, D-015, D-017, D-020, D-040, D-042, D-043, D-045, D-056, D-057, D-058, D-059 · SRs: SR-001..SR-005, SR-010, SR-016, SR-021, SR-042, SR-048, SR-057, SR-066, SR-072, SR-102 · Schema: `schemas/element.schema.json`

## Context

D-015 and D-056 fix "one Markdown file per element, YAML frontmatter, then text". Everything that touches the file format belongs in stage 1 even if the function comes later (D-035). This ADR fixes the remaining details so that no agent invents its own.

## Decision

### Frontmatter

```yaml
---
id: 102ee39b-773f-4cd0-b414-825b7146fb54     # UUID v4, never changes (D-017)
type: system-requirement                      # type key (D-043)
status: draft                                 # status key (D-030)
title: Show wind speed in large digits        # property with meaning `title`
requirement-type: functional
acceptance-criteria:
  - Given ..., when ..., then ...
validity:                                     # meaning `validity` (D-020); absent or empty = all
  - { id: ca0dd4a9-…, version: n1:2c26b46b68ffc68f, title: Pro }
packages:                                     # meaning `packages` (D-040)
  - { id: 19fd3f5e-…, version: n1:4be0643f1d98573b, title: Release 1.0 }
derives-from:                                 # relation kind key
  - { id: 878e339e-…, version: n1:7d865e959b2466f0, title: Wind speed visible at a glance }
  - { id: fe5fce30-…, version: n1:e3b0c44298fc1c14, repository: subsystem-sensor }
customer-id: WS-0815                          # external ID is an ordinary property (D-017)
---
```

- Structural keys: `id`, `type`, `status`. Every other key is a property key or relation kind key of the metamodel. Keys are unique across properties and relation kinds. The origin of imported elements is stored in ordinary properties with the meanings `source`, `source-identifier`, `import-date` and `delivery` (D-059, SR-057); only ReqIF import writes them.
- Values are text, number, date (`YYYY-MM-DD`), choice key, or lists of these. Relation-valued properties and relation kinds hold **relation targets**: `{ id, version }` plus `title` when the target is in the same repository, or `repository` (its workspace name) when it is in another one (D-058). A target across repositories never carries title or text (SR-005 AK1); the tool looks it up in the repository it names and shows its title when it is available locally (SR-005 AK2).
- Validity and packages are relation-valued properties, so they carry a version like any relation and become outdated when the variant or package changes.
- Unknown keys are kept byte for byte and reported as hint `element.unknown-property` (D-012, SR-016). An unknown `type` makes the element read-only (SR-016 AK3).
- A Markdown file counts as an element when its frontmatter has `id` and `type`. Files without frontmatter, or with frontmatter lacking these keys, are ignored and never changed (SR-003 AK2). A file whose frontmatter cannot be parsed is reported (SR-008) and never written.

### Text and inline references

- Below the frontmatter: CommonMark with GitHub extensions (tables, task lists, strikethrough, autolinks), math as `$…$`/`$$…$$` (LaTeX), diagrams as fenced ` ```mermaid ` blocks (SR-065).
- An inline reference to another element (SR-066) is a normal Markdown link with the scheme `logreq:`:
  `[<label>](logreq:<uuid>?version=<version>)`. The label is the title within the same repository and the short ID otherwise (D-058). It renders as a plain link on GitHub and in any editor. Inline references count as relations with the internal meaning `reference` (not a metamodel meaning; it appears only in command output) for outdated checks (SR-066 AK3) and the affected-elements query (SR-024), but not for the chain.
- Images live next to the element file in a folder named like the file without `.md` (`SR-825b7146fb54/layout.png`) and are linked relatively; their bytes count to the version (ADR-0005, SR-065 AK2).

### File name and location

- File name: type prefix, dash, the last 12 hex characters of the UUID, `.md` (D-056), e.g. `SR-825b7146fb54.md`. The displayed short ID is separate: at least 6 characters, longer when needed to be unique (SR-002 AK3). Code gets file names only from one function `fileNameFor(element)` in `core`.
- A clash of two 12-character stems in one folder (about 1 in 10^9 at 50,000 elements) is reported by the check as `element.file-name-clash` and resolved by hand; LogReq never renames.
- The file name never changes after creation, also not on rename or type change (SR-001 AK2).
- Folders are free; LogReq finds elements by frontmatter (SR-003). New elements go to a folder given by the caller, else the type key as folder name.

### Relations

- A relation is stored only in the file of its source. Adding a relation never changes the target file (D-040, N-039: two people adding children to the same parent change different files).
- Direction by meaning (`schemas/metamodel.schema.json`): `derivation` source = child, target = parent; `replacement` source (new) replaces target (old); `exclusion` source variant excludes target core requirement (SR-042: written into the variant file).
- `exclusion` is decided by D-059 (relation kind Excludes on the variant).
- Superseding (D-045, SR-072) uses the meaning `replacement` ("Ersetzt", D-059), answered by Thomas on 2026-10-24; there is no separate successor meaning. A replacement is read as a variant replacement (D-020) when the source has a validity, and as succession when the target has an invalid status (D-044). `element.supersede` with a successor therefore writes the status into the old file and the relation into the successor's file. The standard model offers `supersedes` (any types) and `replaces` (system requirements in variants) with this meaning; when more than one relation kind fits, the caller names it.
- Setting a target (SR-021, spec question #177): a relation or inline reference stores the target's UUID and its version at the moment it is set (plus the same-repository `title`, or `repository` across repositories, D-058). In a relation-valued property a target is the pair of UUID and repository, and a list names each target once (a target given twice is written once). A target the property already stores with a valid `version` keeps its stored entry unchanged (also any other keys in it), whatever version the caller sends, so saving never confirms an outdated relation; only confirming a hint changes a stored version (D-042, SR-027). A stored entry without a valid version gets the current version, or stays as it is when its target cannot be found. Every new target gets its current version; callers give only `id` (and `repository`), the input schema makes `version` optional (`common.schema.json#/$defs/relationTargetInput`). In the text, a reference whose UUID and version the stored text already has is kept; every other one (new, without version, or with a version changed by hand) gets the current version, with other query parameters kept (empty ones, as in `logreq:<uuid>?`, are dropped). A stored reference without version whose target cannot be found is kept as it is, so it never blocks other edits; a new one refuses the write (`ref.unknown`, `ref.ambiguous`). Inline references name no repository (assumption until #177 (c) is answered) and are looked up in the whole workspace. A relation or reference from an element to itself stores the element's version from before the write; when the write changes what counts to the version (always for a reference in the text, since the text counts), the relation is outdated as soon as it is written. LogReq does not treat this case specially. Links are found by one scanner, `packages/core/src/model/markdown-links.ts`: inline links and images on one line, outside fenced code blocks (also in block quotes), indented code blocks and code spans; code spans take precedence over the brackets of a label, and links do not nest (CommonMark); images and escaped brackets are no references; reference-style links, links across lines and HTML are not handled, and a fence indented by 4 or more spaces in a nested list item is not recognised (the file comment lists the cases); each line is read in one pass from left to right with a stack of open brackets (CommonMark), without recursion, and parentheses nest at most 32 deep in a destination, so a line costs about linear time whatever its nesting. Implementation: `packages/core/src/model/targets.ts`.
- Confirming a hint (D-042) rewrites only the `version` (and the same-repository `title`) of that one relation target (SR-027 AK1).

### Stable writing

- LogReq changes only the lines of the keys it changes (ADR-0007, writing frontmatter): existing key order, comments and formatting of untouched keys are kept byte for byte; new keys are appended in the order of the type's properties in the metamodel.
- Lists of relation targets are written as one flow mapping per line, so a Git diff shows one changed line per changed relation (SR-102).
- Line endings: LF on write; existing CRLF files keep CRLF. UTF-8; new files without BOM, an existing BOM is kept like CRLF (so line 1 stays unchanged, SR-102). A final newline.
- Nothing about display order is stored (D-031, SR-075 AK3).

## Consequences

- Files stay readable in any editor and on any Git server (SR-010).
- Merges of different elements never conflict (SR-001 AK3); merges of the same element conflict only on the changed lines.
- The spec export (`scripts/spec-export`) currently writes a preliminary format with Logseq IDs (`SR-036`) as `id`. Moving it to this format is a follow-up; the SR ID then becomes an ordinary property.

## Rejected

- Relations in a separate index file: every new relation would touch one shared file (conflicts, N-039).
- Block-style lists of mappings for relations: three to four lines per relation, noisy diffs.
- Wiki links `[[…]]` for inline references: not CommonMark, not rendered by Git servers.
