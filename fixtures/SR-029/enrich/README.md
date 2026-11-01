# SR-029: enriching JUnit XML

`enrich/`: one repository `system` with the standard model plus the property `spec-id` with the meaning `identifier` (#305), four requirements and the evidence location `evidence/` (empty: `evidence/ci/.gitkeep`). The result files lie outside the evidence folder in `results/`, as a pipeline writes them before `reqseq evidence enrich-junit` (SR-029) runs. `.gitattributes` keeps their bytes (CRLF, byte order mark).

| Requirement | UUID | Named by |
|---|---|---|
| SR-46fb54 | `0b9e7a3c-1d2f-4a5b-8c6d-825b7146fb54` | short ID |
| SR-0b0036 | `93000000-0000-4000-8000-0000000b0036` | short ID |
| SR-0c0037 | `93000000-0000-4000-8000-0000000c0037` | short ID |
| SR-0d0038 | `29000000-0000-4000-8000-0000000d0038` | identifier `SR-036` (`spec-id`) |

`results/pytest.xml` and `results/vitest.xml` are byte copies of `fixtures/junit-samples/` (written by pytest 9.1.1 and Vitest 5.0.5, D-054). `two.xml`, `unknown.xml` and `nextest.xml` are hand-written; `nextest.xml` has test case names as Rust tests have them, which cannot hold brackets (SR-029 AK5, read with `--name-pattern '{prefix}_{id}_ak{ak}'`).

| File | Test case | Names | After enrich |
|---|---|---|---|
| `pytest.xml` | `test_login_by_property` | SR-46fb54 (property) | enriched |
| | `test_add[1-2]`, `test_add[3-4]` | nothing (parameter list) | unchanged |
| | `test_named[SR-46fb54]` | SR-46fb54 (name token) | enriched |
| | `test_named[SR-036]` | SR-0d0038 (identifier) | enriched |
| | `test_fails`, `test_skipped`, `test_error` | nothing | unchanged |
| `vitest.xml` | `login > [SR-46fb54/AK1] accepts a valid password` | SR-46fb54 (property and name token, once) | enriched |
| | `login > adds [1, 2]`, `login > adds [3, 4]` | nothing (a Vitest `each` title) | unchanged |
| | `login > [SR-036] reports a failure` | SR-0d0038 (identifier) | enriched |
| | `login > is skipped` | nothing | unchanged |
| `two.xml` (BOM, CRLF, suite `timestamp` without time zone) | `[SR-0b0036] [SR-0c0037] reports a failure` | SR-0b0036, SR-0c0037 | enriched, two elements with their own versions |
| | `[SR-46fb54] logs in` (self-closing) | SR-46fb54 | enriched |
| | `[SR-46fb54] is skipped` | SR-46fb54 | enriched (a skipped test case) |
| `unknown.xml` | `[SR-ffffff] names no element` | unknown short ID | unchanged, listed |
| | `a typo in the property` | property `SR-0366`, names no element | unchanged, listed |
| | `[SR-46fb54] logs in` | SR-46fb54 | enriched |
| `nextest.xml` (with `{prefix}_{id}_ak{ak}`) | `tests::sr_46fb54_ak1_accepts_a_valid_password` | SR-46fb54 (pattern) | enriched |
| | `tests::sr_0b0036_ak1_and_sr_0c0037_ak2_report_a_failure` | SR-0b0036, SR-0c0037 (pattern) | enriched |
| | `tests::adds_two_numbers` | nothing | unchanged, counted without reference |
| | `tests::sr_029_is_an_identifier` | nothing (`029` is no short ID) | unchanged, counted without reference |
