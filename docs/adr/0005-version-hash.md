# ADR-0005: Version (Fassung) as content hash

Status: Proposed · Based on: D-013, D-027, D-036, D-042, D-057 · SRs: SR-021, SR-025, SR-031, SR-065, SR-091, SR-097 · Schema: `common.schema.json#/$defs/version`

## Context

Relations and references store the version of their target as a hash over its content (D-013). Only line endings, trailing spaces and blank lines are normalised (D-027); the normal form has a version number stored with every hash.

## Decision

**Version string:** `n<normal-form>:<16 hex>`, e.g. `n1:9f86d081884c7d65` — the first 64 bits of SHA-256. The prefix is the normal-form version (D-027). 64 bits are enough because versions are only ever compared for one element.

**Content of normal form 1:**

1. Text: the Markdown body, everything after the line that closes the frontmatter.
2. Every property whose definition has `content: true` (D-013, D-057: the flag "counts to the version" per property; in the standard model text, acceptance criteria, requirement type, verification method, emergent and validity count; title, status, packages, rationale, statement and origin do not). Title, status and properties without the flag are not content (SR-021 AK3). Relation kinds are not content, so a new child does not change the parent. Unknown properties are not content.
3. Embedded images (D-057: "eingebettete Bilder zählen immer mit"): every image the text embeds with a relative link that resolves inside the same repository, with its SHA-256 (see **Files**). Where the editor puts new images (next to the element file) is SR-097 AK1; any image in the repository counts.

**Canonical form (n1):** UTF-8 bytes of

```
logreq-version n1\n
text\n<normalised text as one JSON string>\n
prop <key>\n<canonical JSON of the value>\n      (keys sorted by code point)
file <path>\n<sha256 hex | missing>\n         (paths sorted by code point)
```

- Text normalisation: CRLF and CR to LF; trailing spaces and tabs removed from every line; runs of blank lines collapsed to one; leading and trailing blank lines removed (D-027). Nothing else, also not Unicode normalisation.
- The text is written as one JSON string (escaped like every canonical JSON string), so no text can produce lines that look like a `prop` or `file` section.
- Property values: as parsed by the YAML 1.2 core schema. The same whitespace rules apply to every string; lists keep their order. A relation-valued property contributes the target `id` as a JSON string, and a list of them when the value is a list; nothing else of the target counts, so the version of a validity target does not cascade. A malformed relation entry (no string `id`) is passed through unchanged; the element check reports it.
- Canonical JSON: no whitespace; object keys sorted by code point; strings escaped as `JSON.stringify` does (only `"`, `\`, and control characters, the latter as `\b \f \n \r \t` or lower-case `\u00xx`; every other character as UTF-8, also U+2028); numbers as ECMAScript `Number::toString` (`JSON.stringify`, RFC 8785), e.g. `1`, `0.1`, `1e+21`, and `-0` as `0`. Non-finite numbers (`.inf`, `.nan`) are invalid: computing the version throws.
- Sorting by code point equals the byte order of UTF-8.

**Files (n1):**

- Only image syntax counts: inline `![alt](path)` and reference-style `![alt][ref]` / `![ref]` with a link definition `[ref]: path`. Plain links `[text](path)` and absolute URLs (any scheme, also `file:`) do not count.
- Path normalisation: drop an optional `<…>` wrapper and the link title; percent-decode; resolve against the folder of the element file, removing `./` and resolving `..`. A path that ends outside the repository does not count.
- In the canonical form the path is relative to the folder of the element file, with `/`, after normalisation (it may start with `../` when it stays inside the repository). Each path is written once, however often the text embeds it; the implementation rejects a duplicate path, so the caller dedupes.
- A linked file that does not exist counts with the marker `missing` instead of a hash, so adding the file later changes the version. `<sha256 hex>` is lower case.
- The extraction is implemented later by the model module (it reads the files); `version.ts` takes the normalised paths and hashes. The rule is open as spec question #131; this is option 1.

**Changing the normal form** means a new prefix `n2`. Stored `n1` versions are then compared by recomputing `n1` for the current content, so nothing becomes outdated silently (D-027).

**Version date (D-013 display):** the committer date of the newest commit in which the element file had this version, read via Git (ADR-0006); for a stored older version, LogReq walks the file history until the hash matches, lazily and cached. Uncommitted content has no date (`null`, shown as "uncommitted").

- An absent property, `null` and an empty list are the same and are left out. Numbers are written as JSON numbers, dates as `YYYY-MM-DD` strings, choice values as their key. A property flagged `content` counts only if the element's type has it; unknown keys never count.

**One implementation** in `core` (`packages/core/src/version/version.ts`, pure: the model module passes text, property values, the property definitions of the element's type, and the normalised embedded images with their SHA-256, or `null` when missing). Before any version is stored, stage 1 adds test vectors in `schemas/examples/version/` (input file, canonical bytes, hash) so other tools can reimplement it (N-048, D-013 "also by other tools"). `vectors.yaml` there describes the format; `pnpm schemas:check` checks hash and element schema, a core test recomputes the canonical bytes.

## Consequences

- A status change, a renamed title or a new child relation never makes evidence outdated.
- Reformatting a table makes evidence outdated, as D-027 wants.
- The date lookup needs Git history; in a shallow clone the date may be unknown and is shown as such.
- The cache (ADR-0008) must key a cached version on the embedded files too (size and mtime, or their hash), not only on the element file; otherwise a changed image keeps a stale version.

## Rejected

- Commit hashes or counters as version: lost on rebase, collide on parallel branches (D-013).
- Hash over the whole file: would include title and status.
