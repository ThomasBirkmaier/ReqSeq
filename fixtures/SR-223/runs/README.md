# SR-223/runs

The workspace of `SR-093/views` with the requirement SR-0000a1 and the variants Linux (c1) and macOS (c2), and four JUnit files of one test case, as `reqseq evidence enrich-junit` (SR-029) writes them, for the runs of SR-223 AK4:

| File | Date | Views | Result |
|---|---|---|---|
| `evidence/ci/run-1-linux.xml` | 2026-11-09 | core and Linux | passed |
| `evidence/ci/run-1-macos.xml` | 2026-11-09 | macOS | passed |
| `evidence/ci/run-2-linux.xml` | 2026-11-10 | core and Linux | passed |
| `evidence/ci/run-2-macos.xml` | 2026-11-10 | macOS | failed |

The first run has one result in every view (one row), the second a differing one (a row per view).
