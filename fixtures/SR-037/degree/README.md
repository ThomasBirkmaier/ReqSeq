# SR-037 degree: the verification degree of a selection

One repository `system` with the standard model (`obsolete` is the status marked invalid) and the
evidence location `evidence` (Markdown records, SR-028). No variants: a record without `variant` holds
only in the core. UUIDs `37373737-3737-4737-8737-00000000xxxx`; short IDs are the last six hex digits
(`SR-00b001`). Older version in records: `n1:0000000000000000`. System requirements unless named;
children `derives-from` their parent.

| Element | Status | Own verification record in `evidence/` | Children | Verification (core) | Packages |
|---|---|---|---|---|---|
| R01–R06 `00b001`–`00b006` | draft | passed, current version | – | verified | P1, P3 |
| R07 `00b007` | draft | failed, current version | – | failed | P1, P2, P3 |
| R08 `00b008` | draft | passed, older version | – | outdated | P1, P3 |
| R09 `00b009` | draft | – | – | open | P1, P2, P3 |
| R10 `00b010` | draft | – | C3 | open, missing C3 | P1, P3 |
| I1 `00b101` | draft | – | C1, C2, O2 | indirect (O2 obsolete does not count, D-044) | P2 |
| C1 `00b111`, C2 `00b112` | draft | passed, current version | – | verified | P2 |
| C3 `00b113` | draft | failed, current version | – | failed | – |
| O1 `00b201` | obsolete | passed, current version | – | verified (not counted) | P3 |
| O2 `00b202` | obsolete | failed, current version | – | failed (not counted) | P3 |
| N1 `00a001` need | draft | – | – | – (no requirement) | P3 |
| P1 `00d001`, P2 `00d002`, P3 `00d003` | packages "AK1", "AK2", "AK3" | | | | |

Expected degree (core):

- P1: total 10, open 2, verified 6, indirect 0, failed 1, outdated 1; share 0.6, shown `60 %` (AK1).
- P2: total 5, open 1, verified 2, indirect 1, failed 1, outdated 0; share 0.6 (AK2).
- P3: the same as P1: O1 and O2 are obsolete, N1 is a need (AK3, spec question #592 Q2).
- The whole workspace: total 14 (R01–R10, I1, C1–C3), open 2, verified 8, indirect 1, failed 2,
  outdated 1; share 9/14, shown `64.2 %` (rounded down to one decimal, #592 Q3).

Every relation names the current version of its target. The record versions are the current versions
of the element files; regenerate the records when an element file changes
(`node packages/cli/dist/bin.js element list --json --workspace fixtures/SR-037/degree` gives the versions).
