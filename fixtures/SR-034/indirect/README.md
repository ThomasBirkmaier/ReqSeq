# SR-034 indirect: indirect verification from the children

One repository `system` with the standard model and the evidence location `evidence` (Markdown records,
SR-028). No variants: a record without `variant` holds only in the core. UUIDs
`34343434-3434-4434-8434-00000000xxxx`; short IDs are the last six hex digits (`SR-00b110`).

Derivations (child → parent; `derives-from` unless named):

| Element | Parent | Record in `evidence/` | Verification (core) |
|---|---|---|---|
| N1 `00a001` need | – | – | – (no requirement) |
| G `00b100` | N1 | – | indirect (P1 indirect, C41 verified; AK1) |
| P1 `00b110` | G | – | indirect (C11, C12 verified; AK1) |
| C11 `00b111` | P1 | passed, current version | verified |
| C12 `00b112` | P1 | passed, current version | verified |
| C41 `00b141` | G | passed, current version | verified |
| P2 `00b120` | N1 | – | open, missing C21, C22, C23 (AK2) |
| C21 `00b121` | P2 | failed, current version | failed |
| C22 `00b122` | P2 | – | open |
| C23 `00b123` | P2 | passed, version `n1:0000000000000000` | outdated |
| C24 `00b124` | P2 | passed, current version | verified |
| P3 `00b130` | N1 | – | indirect (C32 obsolete does not count; AK3) |
| C31 `00b131` | P3 | passed, current version | verified |
| C32 `00b132` status obsolete | P3 | – | open |
| P5 `00b150` | N1 | passed, version `n1:0000000000000000` | outdated, nothing missing (own record decides, #526 Q1) |
| C51 `00b151` | P5 | passed, current version | verified |
| P6 `00b160` | N1 | – | open, nothing missing (no counted child, #526 Q2, Q3) |
| C61 `00b161` status obsolete | P6 | – | open |
| U1 `00e161` use case | P6 (`refines`) | – | – (no requirement; does not count for P6) |

Every relation names the current version of its target, so no relation is outdated. The record
versions are the current versions of the element files; regenerate the records when an element file
changes (`node packages/cli/dist/bin.js element list --json` gives the versions).
