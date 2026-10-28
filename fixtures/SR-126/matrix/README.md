# SR-126: test cases and verification status in the traceability matrix

`matrix/`: one repository `system` with the standard model (copied from `fixtures/SR-033/chain`; `obsolete` is the status marked invalid) and the evidence location `evidence/`. UUIDs `5c0e1d2a-0126-4126-8126-000000126xxx`; short IDs are the last six hex digits (`SR-126b01`). Every system requirement `derives-from` the need N-126a01, except b08 and b09, which derive from b07; every relation names the current version of its target. Each requirement has one kind of evidence only, so each assertion proves one thing (B2 of the SR-033 plan review):

| Element | Evidence | Shows |
|---|---|---|
| N-126a01 need "See the wind" | none | a row with neither `testCases` nor `verification` (D2) |
| SR-126b01 Show wind speed | `test_speed[SR-126b01]`: failed in `ci/run-1.xml` (build-601, 2026-10-21), passed in `ci/run-2.xml` (build-602, 2026-10-22), both of the current version | `last` is the passed run, no mark; status `verified` (AK1) |
| SR-126b02 Log wind speed | `test_log[SR-126b02]` in `ci/run-2.xml`, failed, current version | mark `failed`, status `failed` (AK2) |
| SR-126b03 Show the wind trend | `test_trend[SR-126b03]` in `ci/run-1.xml`, passed, older version `n1:0000000000000000` | mark `outdated`, status `outdated` (AK2) |
| SR-126b04 Show gusts | `test_gusts[SR-126b04]` in `ci/run-2.xml`, `<skipped/>` | mark `not-executed`, status `open` (AK2) |
| SR-126b05 Show the wind on the display | only `2026-10-20-SR-126b05-inspection.md` (inspection, passed, current version) | `testCases: []`, status `verified` (spec question #528 Q3) |
| SR-126b06 Warn of strong wind | none | `testCases: []`, status `open` (AK2 „ohne Testfall“) |
| SR-126b07 Show the wind direction, parent of b08 and b09 | none of its own | `testCases: []`, status `indirect` (AK3) |
| SR-126b08 Show the mean direction, SR-126b09 Show the direction range | `test_mean[SR-126b08]`, `test_range[SR-126b09]` in `ci/run-1.xml`, passed, current version | `verified` children |
| SR-126b10 Show the old reading, status `obsolete` | `test_old[SR-126b10]` in `ci/run-1.xml`, passed, current version | cells shown, not counted in the degree (SR-037 AK3) |

Expected degree of all system requirements (core view, SR-037): `total: 9`, `counts: { open: 2, verified: 4, indirect: 1, failed: 1, outdated: 1 }`, `share: 5/9`, shown `55.5 %`. Not counted: b10 (obsolete) and N-126a01 (a need).

SR-120 (`evidence.withoutPassedTest`, core view) lists SR-126b02 (failed only), b04 (skipped: no execution), b05 (inspection only, status `verified`), b06 (none) and b07 (indirect, no test of its own); not b01 (failed, then passed), b03 (passed, of an older version: any version counts, spec question #532), b08, b09 (passed), b10 (obsolete, D-044) and N-126a01 (a need).

The JUnit files are written as `logreq evidence enrich-junit` (SR-029) writes them: one `logreq:version` per `logreq:element`. The versions are the current versions of the element files; regenerate the records when an element file changes (`node packages/cli/dist/bin.js element list --json --workspace fixtures/SR-126/matrix` gives the versions).
