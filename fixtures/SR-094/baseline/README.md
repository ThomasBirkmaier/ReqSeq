# SR-094 baseline: evidence of a baseline

Repository `system` (the workspace root) with the standard model. Elements (prefix `94094094-0000-4000-8000-0000000000`): needs N-0000a1 and N-0000a2; system requirements SR-0000b1 to SR-0000b7, SR-0000b4 valid only in the variant VAR-0000c1 Alpine, SR-0000b6 derived from SR-0000b5. The variant VAR-0000c2 Coastal excludes SR-0000b3; SR-0000b7, valid only in Coastal, replaces SR-0000b2 there.

Baselines, both dated 2026-11-02T14:00:00Z at the current versions:

- `release-1.yaml` „Release 1“, no stored selection (every view): N-0000a1, N-0000a2, SR-0000b1, b2, b3, b5, b6, b7.
- `alpine-1.yaml` „Alpine 1“, stored view Alpine: SR-0000b1, SR-0000b4.

Records (`evidence/`): SR-0000b1 passed at 13:00 and failed at 15:00 in the core, passed at 12:00 and failed at 16:00 in Alpine; SR-0000b2 passed on an older version on 2026-11-01 and on its baseline version on 2026-11-03; SR-0000b4 passed in Alpine at 10:00; SR-0000b6 passed at 10:00; SR-0000b7 passed in Coastal at 11:00; N-0000a1 validated at 13:00 and not validated at 15:00. SR-0000b3, SR-0000b5 and N-0000a2 have none.

Release 1 with evidence (rows core, Alpine, Coastal; `+` a later record named):

- b1: verified +, verified +, open; b2: outdated +, open, none (replaced); b3: open, open, none (excluded); b5: open, open, open (no indirect verification); b6: verified, open, open; b7: Coastal verified only.
- N-0000a1 validated + (the failed record at 15:00), N-0000a2 open.

Alpine 1: b1 verified +, b4 verified, Alpine rows only.
