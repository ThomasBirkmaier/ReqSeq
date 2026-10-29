# SR-030 record: manual verification and validation records written by `evidence.record`

One repository `system` with the standard model and two evidence locations (SR-028): `evidence` and
`reviews` (empty, `.gitkeep`). No variants. UUIDs `30303030-3030-4030-8030-00000000xxxx`; short IDs
are the last six hex digits (`N-00a001`). The versions are those of `reqseq element get <id> --json`;
regenerate the record of S1 when an element file changes.

| Element | Version | Records before | Verification / validation before | After the tagged tests |
|---|---|---|---|---|
| N1 `00a001` need | `n1:0bb580565f4c2d88` | – | validation open | a validation record (AK3): validated |
| S1 `00c001` system requirement, derives from N1 | `n1:c3ac9c276d7c3cce` | `evidence/2026-10-01-SR-00c001-test.md`: verification, test, passed, current | verification core verified; no validation | a validation record failed (AK3): validation failed, verification still core verified |
| S2 `00c002` system requirement, derives from N1 | `n1:8a2f8c93f0261f80` | – | verification core open | a verification record (AK1, AK2): verified; or only a validation record (AK3): still without Nachweis |
| U1 `00e001` use case | `n1:457445548ff2eea9` | – | – | no record may name it (D-012): refused |

Every test works on its own copy (`createFixtureWorkspace`), so the files here never change.
