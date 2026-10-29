# SR-061: data export of a workspace and of a selection

Two repositories: `system` (main, this folder: metamodel = standard model of `fixtures/SR-034/indirect`, evidence location `evidence/`, saved filter, baselines) and `sensor`. UUIDs `61061061-0000-4000-8000-0000000000xx`, short IDs `<prefix>-0000xx`. Store order: system (needs, packages, requirements, variants), then sensor.

| Element | Version | Content |
|---|---|---|
| N-0000a1 | `n1:9d97d0ccf9b75591` | need; validation record passed (`evidence/2026-10-21-N-0000a1-validation.md`): validated (SR-038) |
| PKG-0000d1 | `n1:5862e4d618683af6` | package |
| SR-0000b1 | `n1:697a2ad17ed49170` | derives from a1 (current), validity [c1], packages [d1], `requirement-type: functional`, unknown key `x-supplier`; test passed in VAR-0000c1 (`evidence/2026-10-20-SR-0000b1-test.md`) |
| SR-0000b2 | `n1:077d46fbf1a6a93d` | derives from a1 with the old version `n1:0000000000000000` (outdated), packages [d1], `performance`, supersedes b4; JUnit test failed in the core (`evidence/ci/run-1.xml`, enriched) |
| SR-0000b3 | `n1:4b17a5494b8e80e5` | derives from a1 (current), validity [c2], `functional` |
| SR-0000b4 | `n1:1e68aa41d13d05b1` | status `obsolete`, superseded by b2, `functional` |
| VAR-0000c1, VAR-0000c2 | `n1:f0136de1de07212d`, `n1:88d1931ebfec35a5` | variants Coast, Mountain |
| SR-0000e1 (sensor) | `n1:31d60ac7c791e279` | derives from b1 in `system`, `quality` |

Expected selections (SR-061 AK2):

- saved filter `Functional` (`filters/functional.yaml`): b1, b3, b4
- package PKG-0000d1: b1, b2
- baseline `Release 1` (`baselines/release-1.yaml`, also as `release-1` or `release-1.yaml`): a1, b1, b3 (b3 with an older version; a listed UUID ...ff is in no file); `baselines/broken.yaml` is faulty
- view VAR-0000c1: every element but b3
- saved filter `Functional` with view VAR-0000c1: b1, b4
