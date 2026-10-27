# SR-033: test cases and executions in the chain

`chain/`: one repository with the need N-33a001 "See the wind" and four leaf system requirements that refine it, and the evidence location `evidence/`. Versions are the real current ones (`logreq element get`), so the records are not outdated. Each requirement has one kind of evidence only, so a test that a record closes a gap proves it (plan review B2):

| Requirement | Evidence | Shows |
|---|---|---|
| SR-33b001 Show wind speed | `test_speed[SR-33b001]` in `ci/run-1.xml` (passed, build-512, 2026-10-21) and `ci/run-2.xml` (failed, build-513, 2026-10-22) | a test case with two executions, newest first (AK1) |
| SR-33b002 Log wind speed | the same `<testcase>` of `ci/run-1.xml`, which names SR-33b001 and SR-33b002, each with its version | a test case that counts for two requirements (AK2) |
| SR-33b003 Show gusts | `test_gusts[SR-33b003]` in `ci/run-1.xml`, `<skipped/>` | a test case without execution, and a `no-evidence` gap (AK3, SR-022 AK3) |
| SR-33b004 Show the wind on the display | `2026-10-20-SR-33b004-inspection.md`, an inspection with the Beleg `reports/inspection-b4.pdf` (never opened) | a record without a test case, and no gap (SR-022 AK1, AK3) |

The JUnit files are written as `logreq evidence enrich-junit` (SR-029) writes them: one `logreq:version` per `logreq:element`, in the same order.
