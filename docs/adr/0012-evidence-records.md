# ADR-0012: Evidence records and the JUnit convention

Status: Proposed · Based on: D-007, D-008, D-026, D-056 · SRs: SR-028..SR-034, SR-047 · Schema: `schemas/evidence-record.schema.json`

## Decision

**Manual record (Markdown)**: frontmatter per `evidence-record.schema.json`: `logreq-record: 1`, `kind` (verification | validation), `element` (UUID), `version`, `method` (test | analysis | inspection | demonstration), `variant` (absent = core), `item` (Prüfling), `result` (passed | failed), `date`, `evidence` (where the Beleg is), `test-case`. Free text below. Written by `evidence.record` (SR-030) or by hand or by any tool. File name: `<date>-<short id>-<method>.md`, with `validation` in place of the method for validation records, in an evidence folder from the workspace file. A relative `evidence` path is relative to the record file.

**Automatic record (JUnit XML)**: each `<testcase>` names its requirement by one of
- a property `<property name="logreq:element" value="SR-46fb54"/>` (short ID or UUID), or
- a token `[SR-46fb54]` or `[SR-46fb54/AK2]` in the test case name.

After a run, `logreq evidence enrich-junit --item <build> results.xml` (SR-029) adds per test case `logreq:element` (UUID), `logreq:version`, `logreq:item`, `logreq:date` and optionally `logreq:variant`. Result: passed unless the test case has `<failure>` or `<error>`; `<skipped>` gives no record. Method is `test`, kind is `verification`. Unknown IDs: exit code 1 and a list (SR-029 AK2). Several IDs on one test case count for each (SR-033 AK2). Test case name and class name give the test case; each file is one execution (Durchführung).

**Reading**: all records in the evidence folders of the workspace file, recursively, `*.md` with `logreq-record` and `*.xml` with a JUnit root (SR-028). Records are never modified except by `enrich-junit`, and Belege are never written (D-007).

**Status** (SR-031): per element and view the newest record for the current version decides (verified or failed); records only for older versions give outdated; none gives open. Indirect verification (SR-034): a parent without own record is indirectly verified when all its valid children (status not invalid, valid for the view) are verified or indirectly verified; not when it is flagged emergent (SR-035). Validation status the same way with `kind: validation` only (SR-038).

## Consequences

- Any test tool that writes JUnit works without code (SR-063 AK1); pytest and Vitest examples come in `toolchain/` (D-054).

## Block and state

The records live in the core block `evidence` (`packages/core/src/evidence/`, block doc `packages/core/docs/evidence-records.md`), built in stage 4 enabler #535:

- **Folders**: every `*.md` and `*.xml` file below each `evidence` location of the workspace file, walked by the rules of the element store (no `.git` or `node_modules`, no nested repository, the `ignore` globs, links never followed). A location in a repository that is not on this machine makes every result built on the records `incomplete`; a missing folder in an available repository is `evidence.folder-missing` (info).
- **Readers**: one per extension (`md`, `xml`), each given one file and its bytes; it reads nothing else. A Markdown file without `logreq-record` and XML without a JUnit root give nothing.
- **State**: `evidenceReadState` holds what the readers found (`records`, `skipped`, `problems`, `incomplete`); `evidenceRecordsState` is its records as an array. Commands and tests get records through that array, so a consumer is built and tested with records it injects, without files.
- **Record**: `data-export.schema.json#/$defs/evidenceRecord`, from a Markdown record or from one element of a JUnit test case alike, with its location (`source`, `repository`, `file`, `line`) and the JUnit `className`.
- **Test case**: identified by JUnit `classname` + `name`, or by the `test-case` of a Markdown record alone; records with the same identity are one test case across files, and each file is one execution. A `<skipped>` test case gives no record but is kept as a test case without execution. A test case is always shown from one element (`$defs/testCase`): its executions are that element's records, since version and outdatedness belong to the element; `elements` lists every element it names.
- **Index**: records by element, newest first (date as an instant, then repository, file, line), and the test cases. "Has evidence" is one function for filter, chain and coverage: a verification record in the view (core: no variant; a variant: for that variant). Validation records never count as Nachweis (D-007).

## Status rules

Nachweisstatus and Validierungsstatus are derived views; they never change the element's `status` (D-030).
