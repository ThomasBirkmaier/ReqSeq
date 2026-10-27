# SR-061: data export of a workspace and of a selection

Two repositories: `system` (main, this folder: metamodel = standard model of `fixtures/SR-034/indirect`, evidence location `evidence/`, saved filter, baselines) and `sensor`. UUIDs `61061061-0000-4000-8000-0000000000xx`, short IDs `<prefix>-0000xx`. Store order: system (needs, packages, requirements, variants), then sensor.

| Element | Version | Content |
|---|---|---|
| N-0000a1 | `n1:c2b89c0554cf891b` | need; validation record passed (`evidence/2026-10-21-N-0000a1-validation.md`): validated (SR-038) |
| PKG-0000d1 | `n1:36c40870aebec141` | package |
| SR-0000b1 | `n1:d7089e63fea26191` | derives from a1 (current), validity [c1], packages [d1], `requirement-type: functional`, unknown key `x-supplier`; test passed in VAR-0000c1 (`evidence/2026-10-20-SR-0000b1-test.md`) |
| SR-0000b2 | `n1:46f520a356e92a87` | derives from a1 with the old version `n1:0000000000000000` (outdated), packages [d1], `performance`, supersedes b4; JUnit test failed in the core (`evidence/ci/run-1.xml`, enriched) |
| SR-0000b3 | `n1:79eb8daf0d9b3780` | derives from a1 (current), validity [c2], `functional` |
| SR-0000b4 | `n1:4e09d2361f4d1948` | status `obsolete`, superseded by b2, `functional` |
| VAR-0000c1, VAR-0000c2 | `n1:bbd84fb6aed6ac43`, `n1:6f4623cafec0993e` | variants Coast, Mountain |
| SR-0000e1 (sensor) | `n1:195697954ef3980b` | derives from b1 in `system`, `quality` |

Expected selections (SR-061 AK2):

- saved filter `Functional` (`filters/functional.yaml`): b1, b3, b4
- package PKG-0000d1: b1, b2
- baseline `Release 1` (`baselines/release-1.yaml`, also as `release-1` or `release-1.yaml`): a1, b1, b3 (b3 with an older version; a listed UUID ...ff is in no file); `baselines/broken.yaml` is faulty
- view VAR-0000c1: every element but b3
- saved filter `Functional` with view VAR-0000c1: b1, b4
