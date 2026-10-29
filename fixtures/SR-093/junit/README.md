# SR-093: JUnit XML as records

`junit/`: one repository with three requirements and the evidence location `evidence/`. `evidence/ci/vitest.xml` is the Vitest sample of `fixtures/junit-samples/` (Vitest 5.0.5) with test case names that use the short IDs of this workspace, enriched as `reqseq evidence enrich-junit` (SR-029) writes it: the existing `<properties>` block of the first test case gets the properties appended, the others get a new block after the start tag.

| Line | Test case | Names | Version | Outcome |
|---|---|---|---|---|
| 4 | `[SR-46fb54/AK1] accepts a valid password` | SR-46fb54 | older (`n1:1111111111111111`) | passed |
| 13, 15 | `adds [1, 2]`, `adds [3, 4]` | nothing (a Vitest `each` title) | | passed |
| 17 | `[SR-0b0036] [SR-0c0037] reports a failure` | SR-0b0036, SR-0c0037 | older, current | failed |
| 34 | `[SR-46fb54] is skipped` | SR-46fb54 | current | skipped |

`reqseq workspace check` reports `evidence.outdated` for SR-46fb54 (line 4) and SR-0b0036 (line 17) only: SR-0c0037 has a record of its current version, and the skipped test case gives no record, so it does not hide the outdated one of SR-46fb54.
