# SR-038 validation: the validation status apart from the verification status

One repository `system` with the standard model and the evidence location `evidence` (Markdown records,
SR-028). No variants. UUIDs `38383838-3838-4838-8838-00000000xxxx`; short IDs are the last six hex
digits (`N-00a001`). Older version in records: `n1:0000000000000000`.

| Element | Records in `evidence/` | Validation | Verification (core) |
|---|---|---|---|
| N1 `00a001` need | validation passed, current; verification failed, current | validated (AK1) | – (a need has none, D-012) |
| N2 `00a002` need | validation failed, current | failed (AK3) | – |
| N3 `00a003` need | validation passed, older version | outdated (AK2); hint `evidence.outdated` | – |
| N4 `00a004` need | – | open (AK3) | – |
| N5 `00a005` need | validation passed 2026-01-01 and failed 2026-02-01, both current | failed (the newest of the current version, AK3) | – |
| N6 `00a006` need | validation passed 2026-01-01 current; failed 2026-02-01 older version | validated (the current version beats a newer older one, AK3); hint `evidence.outdated` | – |
| S1 `00b001` system requirement, derives from N1 | validation passed, current; verification failed, current | validated | failed (AK1: separate) |
| S2 `00b002` system requirement, derives from N1 | verification passed, current | – (no validation record, #534) | verified |
| U1 `00e001` use case | validation failed, current | failed (#534 Q3) | – |

Every relation names the current version of its target. The record versions are the current versions
of the element files; regenerate the records when an element file changes.
