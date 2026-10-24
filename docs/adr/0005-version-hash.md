# ADR-0005: Version (Fassung) as content hash

Status: Proposed · Based on: D-013, D-027, D-036, D-042, D-057 · SRs: SR-021, SR-025, SR-031, SR-065 · Schema: `common.schema.json#/$defs/version`

## Context

Relations and references store the version of their target as a hash over its content (D-013). Only line endings, trailing spaces and blank lines are normalised (D-027); the normal form has a version number stored with every hash.

## Decision

**Version string:** `n<normal-form>:<16 hex>`, e.g. `n1:9f86d081884c7d65` — the first 64 bits of SHA-256. The prefix is the normal-form version (D-027). 64 bits are enough because versions are only ever compared for one element.

**Content of normal form 1:**

1. Text: the Markdown body after the frontmatter.
2. Every property whose definition has `content: true` (D-013, D-057: the flag "counts to the version" per property; in the standard model text, acceptance criteria, requirement type, verification method, emergent and validity count; title, status, packages, rationale, statement and origin do not). Title, status and properties without the flag are not content (SR-021 AK3). Relation kinds are not content, so a new child does not change the parent. Unknown properties are not content.
3. Images and other files linked relatively from the text and lying in the element's own folder (SR-065 AK2): their SHA-256.

**Canonical form (n1):** UTF-8 bytes of

```
logreq-version n1\n
text\n<normalised text>\n
prop <key>\n<canonical JSON of the value>\n      (keys sorted by code point)
file <relative path>\n<sha256 hex>\n            (paths sorted)
```

- Text normalisation: CRLF and CR to LF; trailing spaces and tabs removed from every line; runs of blank lines collapsed to one; leading and trailing blank lines removed (D-027). Nothing else, also not Unicode normalisation.
- Property values: the same whitespace rules for every string; lists keep their order; relation targets contribute only their `id` (the version of a validity target must not cascade).
- Canonical JSON: no whitespace, keys sorted.

**Changing the normal form** means a new prefix `n2`. Stored `n1` versions are then compared by recomputing `n1` for the current content, so nothing becomes outdated silently (D-027).

**Version date (D-013 display):** the committer date of the newest commit in which the element file had this version, read via Git (ADR-0006); for a stored older version, LogReq walks the file history until the hash matches, lazily and cached. Uncommitted content has no date (`null`, shown as "uncommitted").

- An absent property, `null` and an empty list are the same and are left out. Numbers are written as JSON numbers, dates as `YYYY-MM-DD` strings, choice values as their key. A property flagged `content` counts only if the element's type has it; unknown keys never count.

**One implementation** in `core` (`version.ts`). Before any version is stored, stage 1 adds test vectors in `schemas/examples/version/` (input file, canonical bytes, hash) so other tools can reimplement it (N-048, D-013 "also by other tools").

## Consequences

- A status change, a renamed title or a new child relation never makes evidence outdated.
- Reformatting a table makes evidence outdated, as D-027 wants.
- The date lookup needs Git history; in a shallow clone the date may be unknown and is shown as such.

## Rejected

- Commit hashes or counters as version: lost on rebase, collide on parallel branches (D-013).
- Hash over the whole file: would include title and status.
