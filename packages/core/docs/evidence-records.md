# Evidence block: records (`src/evidence/`)

Part of the [`@logreq/core` README](../README.md). Lane A of stage 4 fills this file (readers, `evidence.record`, `evidence.enrichJunit`); the status rules are in [evidence-status.md](evidence-status.md), the views in [evidence-views.md](evidence-views.md).

The evidence records (Datensätze) of a workspace as an in-memory list, indexed by element, with the test cases they form (ADR-0012 "Block and state"). Producers (the Markdown and JUnit readers, `evidence.record`, `evidence.enrichJunit`) write or read records; consumers (status, coverage, degree, list, chain, matrix, export) only read them. The block imports the model, workspace and variants blocks, never `commands`; it never computes or writes the `status` of an element (D-030).

## Model

- `EvidenceRecord` (`record.ts`) is `data-export.schema.json#/$defs/evidenceRecord`: the fields of a record (`evidence-record.schema.json`), plus where it lies (`source`: `markdown` | `junit`, `repository`, `file`, `line`: of the `<testcase>`, 1 for a Markdown record), the JUnit `className`, and `baselines` (only `evidence.list` fills it, SR-032 AK2). The readers always set the location fields; records injected through `evidenceRecordsState` may leave them out.
- `SkippedTestCase`: a JUnit test case marked `<skipped>` that names elements. It gives no record (ADR-0012) and is kept so the test case is listed without execution (SR-033 AK3).
- `testCaseKey(name, className)`, `testCaseKeyOf(record)`: the identity of a test case, JUnit `classname` + `name`, or the `test-case` of a Markdown record alone, as `JSON.stringify([className ?? null, name])` so no name can pass for another class and name. Records with the same key are one test case across files; each `<testcase>` and each Markdown record is one execution (a JUnit file that holds a test case twice gives two).
- `TestCase` is `$defs/testCase`: a test case seen from one element (#535). `executions` holds that element's records only, newest first, `last` is `executions[0]`, `elements` lists every element the test case names; a test case with only skipped appearances has `executed: false` and `executions: []`.

## Folders

`evidenceFiles(layout)` (`folders.ts`): every `*.md` and `*.xml` file below each `evidence` location of the workspace file, in any repository of the workspace, through `listFiles` of the model block (the walk of the element store with a start folder and an extension list: no `.git` or `node_modules`, no nested repository, the `ignore` globs, links never followed, `.MD`/`.XML` a `file.skipped` warning). Result `{ files: { repository, file, absolute, ext }[], incomplete, problems }`:

- a location in a repository that is not on this machine sets `incomplete` (SR-006 AK2, SR-036 AK3);
- a location whose repository the workspace file does not list is left out (the layout reports it);
- the location folder itself follows the walk rules: one that is or lies below a link, in `.git` or `node_modules`, matched by an `ignore` glob, in another repository of the workspace (name that repository in the location) or in a nested Git repository is `file.skipped` (warning); one that does not exist (or is a file) is `evidence.folder-missing` (info); one that cannot be looked at (`EACCES`) is `file.unreadable` (error). An `ignore` glob that keeps the store out of an evidence folder hides its records too;
- a file or walk problem two locations both reach is listed once.

Nobody shows the problems yet; SR-028 shows them through its `evidenceProblemsState` (`workspace.check`).

## State

- `evidenceReadState` (`state.ts`, depends on `workspaceLayoutState`): `readEvidence(layout, readers)`: the files of `evidenceFiles`, each given with its bytes to the reader of its extension, 16 at a time; `{ records, skipped, problems, incomplete }`. A file without a reader is not read; one that cannot be read is `file.unreadable`.
- `EVIDENCE_READERS`: one `EvidenceReader` (`{ extension, read(file, bytes) }`) per extension: the JUnit reader (`xml`, SR-093); SR-028 adds the Markdown reader (`md`), one line. A reader reads nothing else and gives nothing for a file that is no record of its kind.
- `evidenceRecordsState` (depends on `evidenceReadState`): the records alone, an array. It is the seam through which tests and consumers get records without files (#127 option 1): `workspace.replace(evidenceRecordsState, current, Promise.resolve(records))`. Skipped test cases are injected by replacing `evidenceReadState` first (replacing it resets `evidenceRecordsState`). The check of SR-025 AK4 (`hints/evidence.ts`) reads it.

## Index

`evidenceIndex(records, skipped)` (`by-element.ts`), and `evidenceIndexState` (from `evidenceRecordsState` and the `skipped` of `evidenceReadState`). Pure: matching against the store (unknown elements, current versions) belongs to the consumers.

- `byElement`: the records of each element, newest first (`newestFirst`: `date` as an instant, an unreadable date the oldest, then repository, file, line; `sortNewestFirst` parses each date once).
- `testCases`: every test case by key (`TestCaseEntry`: name, class name, the elements it names, all its records newest first), ordered by class name, then name.
- `testCasesOf(id)`: the test cases that name the element, each seen from it (`TestCase`), from the records per element each entry keeps (`recordsOf`), so a call costs the test cases of the element and their executions, never the records of other elements; built once per element and kept.
- `hasVerificationRecord(index, id, view)`: at least one verification record in the view (core: a record without variant; a variant: a record for it, SR-047). The one definition of "has evidence" ("ohne Nachweis", SR-069 AK3; the `no-evidence` gap, SR-022 AK3; coverage, SR-036) for the filter, the chain and the coverage (#535). Version and result do not count (spec question #527).

## Markdown reader

SR-028 (#40).

## JUnit reader

SR-093 (#105). `readJunitRecords(location, bytes)` (`junit.ts`), registered as `JUNIT_READER` for `xml`: the records of an enriched JUnit XML file, read with the XML scanner and the JUnit model (`files/xml-scan.ts`, `evidence/junit-model.ts`, E2, ADR-0012 "JUnit XML"). It reads the bytes only, never the element store: whether a UUID names an element of the workspace is the consumers' question (`evidence.unknown-element`, SR-028).

- A test case is enriched when it has a `logreq:version` property. Its `logreq:element` properties (UUIDs, any case, kept in lower case) name the requirements, and the n-th `logreq:version` is the version of the n-th `logreq:element`; `logreq:item` and `logreq:date` are required, `logreq:variant` is optional (absent: the core). It gives one record per element (a repeated element with the same version once, with two different versions `evidence.invalid-record`; SR-033 AK2): kind `verification`, method `test`, result `failed` with `<failure>` or `<error>`, else `passed`, `testCase` the JUnit `name`, `className` the `classname` (left out when empty), `source: junit`, the repository, file and line of the `<testcase>`.
- A test case that names no requirement (no `logreq:element` property, no short ID or UUID token in its name) is passed over without a problem (AK2). A pytest parameter list (`test_add[1-2]`) or an identifier in brackets (`[SR-036]`) is no reference the reader can tell without the store, so it is passed over too.
- A test case that names a requirement but has no `logreq:version` gives no record. The file gets one `evidence.not-enriched` warning with the number of such test cases and the line of the first (spec question #529 Q3), not one per test case, so an unenriched CI file of thousands of test cases gives one line.
- An enriched test case marked `<skipped>` gives no record, so it never counts as passed (AK3); it is a `SkippedTestCase`, a test case without execution (SR-033 AK3).
- An enriched test case whose properties do not fit gives no record and an `evidence.invalid-record` error with its line: a `logreq:element` that is no UUID (a short ID left by hand: enrich writes the UUID, #529 Q4), element and version counts that differ, an element given twice with different versions, a malformed version, item, date or variant, or item, date or variant given twice with different values. A file the scanner refuses is `evidence.invalid-record` with the scanner's line; XML whose root is not `testsuites`/`testsuite` gives nothing.
- Problems of a file come by line. Nobody shows them yet; SR-028's `evidenceProblemsState` shows the problems of `evidenceReadState` in `workspace.check`.
- Cost: linear in the file; the JUnit model is most of it (a 29 MB file with 50,000 enriched test cases reads in a few seconds). Memory is the larger risk: the model holds about 17 times the file (an 18 MB file, 313 MB heap), and `readEvidence` reads 16 files at a time, so many large CI files at once can need several GB. E4 measures peak heap next to time and, if needed, lowers the concurrency for `xml` or bounds the bytes in flight.

## Writing records

`evidence.record` (SR-030) and `evidence.enrichJunit` (SR-029).
