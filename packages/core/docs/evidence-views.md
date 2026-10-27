# Evidence block: views and export (`src/evidence/`, `src/data/`)

Part of the [`@logreq/core` README](../README.md). Lane C of stage 4 fills this file; the records, folders and index are in [evidence-records.md](evidence-records.md).

"Has evidence" is `hasVerificationRecord` of the index for every view below (#535).

## Coverage

SR-036 (#48), `evidence.coverage` (`commands/evidence/coverage.ts`), block file `evidence/coverage.ts`:

- `coverageRules(graph, index, views)`: what decides the coverage of each element, on one derivation graph (trace block) and the evidence index, for the views of the selection (`Selected.views`: its own view, then the saved filter's).
  - Levels: the element types with the meaning `need` or `requirement` (own or inherited; a subtype is its own level), in metamodel order. Other types have no level. Evidence counts only for requirement types (D-012).
  - Counted: an element whose status the metamodel does not mark invalid (AK4, D-044).
  - Child: a derivation child of `childrenOf` (incoming relations of a kind with the meaning `derivation`, in any repository; one named only by an ambiguous relation is none, SR-088) whose status is not marked invalid and that applies in every view of the selection; without a view every one, as the chain and the matrix narrow.
  - Evidence: `hasVerificationRecord` in the selection's view, the core without one (as the filter condition `verification`); any version and result (spec question #527).
- `coverageOf(elements, rules)`: one `CoverageLevel` per level type with a counted element, with the counts and the UUIDs behind each number in selection order (AK2). The command adds `incomplete`: a repository of the workspace file is not on this machine (the selection's `incomplete`, AK3), or the evidence state is incomplete.
- Cost: one pass over the selection and each element's incoming relations once (N-036); measured with the other stage 4 commands in E4.
- The assumptions of spec question #527 (level = type, needs count for children only, evidence = any verification record in the view) are not decided yet. SR-042 (exclusion for a variant, stage 5) narrows the view's selection there.

## Evidence list and baselines

SR-032 (#44), `evidence.list` (`commands/evidence/list.ts`), block file `evidence/views.ts`; the baselines come from the read-only reader of the [baselines block](baselines.md):

- `listedRecords(records, view, containing)`: the element's records of the index (`byElement`, newest first) that hold for the view (`recordHoldsIn`: the core takes the records without a variant, a variant the records for it, SR-047; no view every record), each with `baselines`, the names `containing(element, version)` gives (an empty list when no baseline holds the version). The fields of AK1 (version, item, date, result, evidence) are the record's own, shown as read; the evidence (Beleg) is text and is never fetched or opened (offline).
- The command adds `problems`: those of the baseline files (a faulty file names no baseline), and `incomplete`: an evidence location (`evidenceReadState`) or the baselines folder is in a repository that is not on this machine (SR-006 AK2).
- `testCases`: the element's test cases (SR-033, `testCasesIn` below), every kind of record as `records`, with `view` as for `records`; always given.
- Cost: the element's records, and for each record one set lookup per baseline file; the baseline files are parsed once and kept by size and time (`baselineFilesState`).
- `trace.affected` (SR-024 AK4) takes its records from the same index: the element's records whose version is not its current one (`currentVersionsOf`, only when it has records); none while its current version cannot be computed.
- The element view of the app shows this list in a later PR (SR-032 AK1 in the app).

## Test cases in the chain and the matrix

SR-033 (#45), block file `evidence/views.ts`; `trace.chain` (`commands/trace/chain.ts`) and `evidence.list` use it; SR-126 (the matrix) will too.

- `testCasesIn(index, id, view, kinds?)`: the test cases that name the element (`index.testCasesOf`, `$defs/testCase` seen from that element, by class name then name), each with only the executions that hold for `view` (`recordHoldsIn`) and are of one of `kinds`; `last` is recomputed. A test case that had executions and has none left is left out; one that was only skipped (`executed: false`) stays in every view, since `SkippedTestCase` carries no variant. So a test case executed only for a variant and skipped in the core run is left out of the core view, not shown as not executed (it had executions, none of them hold there). When nothing is filtered out (the usual case: JUnit records are always verification) it returns the index's own array, no copy.
- `chainEvidenceOf(index, id, view)`: what `trace.chain` shows below an element (`evidence`): `testCasesIn(…, ["verification"])` and the element's verification records without a test case (inspection, analysis, demonstration, a manual record without `test-case`), newest first, those that hold for `view` (every one without a view, as `evidence.list`). Validation records are not Nachweise (D-007) and stay out of the chain. Undefined when the element has neither.
- The Beleg of an execution (AK1 „mit Datum, Ergebnis, Prüfling und Beleg“) is the record's `evidence`; a JUnit execution has none, so its Beleg is its record file (`repository`, `file`, `line`; D-007: for automatic tests the record is the result file; assumption A5, spec question #528 Q4). Belege are text and never opened.
- The `no-evidence` gap of the chain is `hasVerificationRecord` in the view, the core without one (as coverage and the filter); a skipped test case gives no record, so it does not close a gap. Without a view the chain shows the records of every variant but decides the gap in the core (spec question #527 Q4).
- Assumptions (spec questions #528 Q1 and Q4): a „Testfall ohne Durchführung“ is a JUnit test case that is `<skipped>` everywhere it names the element (A1; one skipped in one run and executed in another is executed); the chain shows verification records only, records without a test case next to the test cases (A2); a test case that names several requirements is shown at each with that requirement's own executions and counts as evidence for each (A3, SR-033 AK2); two files of one repository with one UUID show the same evidence (A4).
- Cost: `trace.chain` asks `hasVerificationRecord` for each requirement without a child of the whole downward chain (one map lookup, no allocation) and builds `chainEvidenceOf` only for the expanded downward nodes of the page (`ChainOutputContext.evidenceOf`, [trace block](trace.md)), so a page of 200 nodes builds the evidence of 200 elements, and `testCasesOf` caches only those. The first downward chain also builds `evidenceReadState` and `evidenceIndexState`; the upward chain reads no records. Measured on the generated workspace (50,000 elements, 4 cores, the machine under a load average of 13 to 17, so the absolute times are high): `[SR-082/AK4]` (`test/perf/open-filter-chain.test.ts`, no evidence location) gave 480 and 486 ms for the first page before SR-033 and 516 and 803 ms after it, run alternately, while the walk-only line of the same test (no evidence code) moved from 517–806 to 772–878 ms, so the difference is the load. In one process, alternating 15 times on the first need, first page (medians): the chain without evidence 248 and 276 ms, with the evidence wiring on an empty index 227 ms, with 77,599 JUnit records (1 to 3 per system requirement) 264 ms. Building the evidence index of those records took 0.84 to 1.24 s, once per load of the records (the first downward chain or any other evidence command pays it). That cold build of `evidenceIndexState` at N-036 and the chain with records shaped like real data (time, heap and the JSON size at `limit` 5000, since a test case that names several requirements repeats `elements` at each) are measured in E4 (#583).

## Data export and store

SR-061, SR-062.
