# SR-035 emergent: emergent requirements need their own record

One repository `system` with the standard model (property `emergent`, kind `choice`, meaning `emergent`,
choices `yes`/`no`) and the evidence location `evidence` (Markdown records, SR-028). No variants: a
record without `variant` holds only in the core. UUIDs `35353535-3535-4535-8535-00000000xxxx`; short
IDs are the last six hex digits (`SR-00b110`). Older version in records: `n1:0000000000000000`.

An element is emergent when its property with the meaning `emergent` holds the choice key `yes`
(assumption, spec question #591 Q1).

| Element | `emergent` | Parent (`derives-from`) | Record in `evidence/` | Verification (core) |
|---|---|---|---|---|
| N1 `00a001` need | – | – | – | – (no requirement; validation open) |
| G `00b100` | (absent) | N1 | – | open, missing E1 (rule 4: an emergent child without own record) |
| E1 `00b110` | `"yes"` | G | – | open, nothing missing (AK1: its children do not count) |
| C11 `00b111` | – | E1 | passed, current version | verified |
| C12 `00b112` | – | E1 | passed, current version | verified |
| P1 `00b120` | `"no"` | G | – | indirect (`no` is no mark) |
| C13 `00b121` | – | P1 | passed, current version | verified |
| E2 `00b130` | `"yes"` | N1 | passed, current version | verified (own record, AK1) |
| C21 `00b131` | – | E2 | passed, current version | verified |
| E3 `00b140` | `"yes"` | N1 | passed, version `n1:0000000000000000` | outdated (own record of an older version; not indirect) |
| C31 `00b141` | – | E3 | passed, current version | verified |
| E4 `00b150` | `yes` unquoted (written by hand, a YAML 1.2 string) | N1 | – | open |

The condition `{emergent: true}` finds E1, E2, E3 and E4; `{emergent: false}` finds all others.

Every relation names the current version of its target, so no relation is outdated. The record
versions are the current versions of the element files; regenerate the records when an element file
changes (`node packages/cli/dist/bin.js element list --workspace fixtures/SR-035/emergent --json` gives
the versions).
