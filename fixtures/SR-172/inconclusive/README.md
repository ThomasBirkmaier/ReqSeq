# SR-172 inconclusive: a validation that cannot be judged yet, with its reason

The layout of `SR-038/validation` (one repository `system`, the evidence location `evidence`), with a
metamodel of needs only. UUIDs `17201720-1720-4720-8720-00000000xxxx`; short IDs are the last six hex
digits (`N-00a001`). Older version in records: `n1:0000000000000000`.

| Element | Records in `evidence/` | Validation |
|---|---|---|
| N1 `00a001` | inconclusive with reason, current | inconclusive, with the reason (AK2) |
| N2 `00a002` | inconclusive 2026-10-01, passed 2026-11-01, both current | validated (the newest decides) |
| N3 `00a003` | passed 2026-10-01, inconclusive with reason 2026-11-01, both current | inconclusive, with the reason (AK2) |
| N4 `00a004` | inconclusive with reason, older version | outdated, no reason |
| N5 `00a005` | inconclusive without reason, current | open: the record is `evidence.invalid-record` and counts for no status (AK1, #807 Q1) |

The record versions are the current versions of the element files; regenerate the records when an
element file changes.
