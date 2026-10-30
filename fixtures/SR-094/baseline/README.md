# SR-094 baseline: evidence of a baseline

Repository `system` (the workspace root) with the standard model. Elements (prefix `94094094-0000-4000-8000-0000000000`): need N-0000a1; system requirements SR-0000b1 to SR-0000b6, SR-0000b4 valid only in the variant VAR-0000c1 Alpine, SR-0000b6 derived from SR-0000b5.

Baselines, both dated 2026-11-02T14:00:00Z at the current versions:

- `release-1.yaml` „Release 1“, no stored selection (the core): N-0000a1, SR-0000b1, b2, b3, b5, b6.
- `alpine-1.yaml` „Alpine 1“, stored view Alpine: SR-0000b1, SR-0000b4.

Records (`evidence/`): SR-0000b1 passed at 13:00 and failed at 15:00; SR-0000b2 passed on an older version on 2026-11-01 and on its baseline version on 2026-11-03; SR-0000b4 passed in Alpine at 10:00; SR-0000b6 passed at 10:00. SR-0000b3 and SR-0000b5 have none.

Release 1 with evidence: b1 verified, b2 outdated, b3 open, b5 open (no indirect verification), b6 verified, N-0000a1 none. Alpine 1: b1 open, b4 verified.
