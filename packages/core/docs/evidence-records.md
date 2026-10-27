# Evidence block: records (`src/evidence/`)

Part of the [`@logreq/core` README](../README.md). Lane A of stage 4 fills this file (readers, `evidence.record`, `evidence.enrichJunit`); the status rules are in [evidence-status.md](evidence-status.md), the views in [evidence-views.md](evidence-views.md).

The evidence records (Datensätze) of a workspace as an in-memory list, indexed by element, with the test cases they form (ADR-0012 "Block and state"). Producers (the Markdown and JUnit readers, `evidence.record`, `evidence.enrichJunit`) write or read records; consumers (status, coverage, degree, list, chain, matrix, export) only read them. The block imports the model, workspace and variants blocks, never `commands`; it never computes or writes the `status` of an element (D-030).

## Model

- `EvidenceRecord` (`record.ts`) is `data-export.schema.json#/$defs/evidenceRecord`: the fields of a record (`evidence-record.schema.json`), plus where it lies (`source`: `markdown` | `junit`, `repository`, `file`, `line`: of the `<testcase>`, 1 for a Markdown record), the JUnit `className`, and `baselines` (only `evidence.list` fills it, SR-032 AK2). The readers always set the location fields; records injected through `evidenceRecordsState` may leave them out.
- `SkippedTestCase`: a JUnit test case marked `<skipped>` that names elements. It gives no record (ADR-0012) and is kept so the test case is listed without execution (SR-033 AK3).
- `testCaseKey(name, className)`, `testCaseKeyOf(record)`: the identity of a test case, JUnit `classname` + `name`, or the `test-case` of a Markdown record alone. Records with the same key are one test case across files; each file is one execution.
- `TestCase` is `$defs/testCase`: a test case seen from one element (plan review B2). `executions` holds that element's records only, newest first, `last` is `executions[0]`, `elements` lists every element the test case names; a test case with only skipped appearances has `executed: false` and `executions: []`.

## Folders

`evidenceFiles(layout)` (`folders.ts`): every `*.md` and `*.xml` file below each `evidence` location of the workspace file, in any repository of the workspace, through `listFiles` of the model block (the walk of the element store with a start folder and an extension list: no `.git` or `node_modules`, no nested repository, the `ignore` globs, links never followed, `.MD`/`.XML` a `file.skipped` warning). Result `{ files: { repository, file, absolute, ext }[], incomplete, problems }`:

- a location in a repository that is not on this machine sets `incomplete` (SR-006 AK2, SR-036 AK3);
- a location whose repository the workspace file does not list is left out (the layout reports it);
- a location that does not exist (or is a file) in an available repository is `evidence.folder-missing` (info); one that is or lies below a link is `file.skipped` (warning);
- a file or walk problem two locations both reach is listed once.

Nobody shows the problems in E1; SR-028 shows them through its `evidenceProblemsState` (`workspace.check`).

## State

- `evidenceReadState` (`state.ts`, depends on `workspaceLayoutState`): `readEvidence(layout, readers)`: the files of `evidenceFiles`, each given with its bytes to the reader of its extension, 16 at a time; `{ records, skipped, problems, incomplete }`. A file without a reader is not read; one that cannot be read is `file.unreadable`.
- `EVIDENCE_READERS`: one `EvidenceReader` (`{ extension, read(file, bytes) }`) per extension. Empty until SR-028 (Markdown) and SR-093 (JUnit) add theirs, one line each. A reader reads nothing else and gives nothing for a file that is no record of its kind.
- `evidenceRecordsState` (depends on `evidenceReadState`): the records alone, an array. It is the seam through which tests and consumers get records without files (#127 option 1): `workspace.replace(evidenceRecordsState, current, Promise.resolve(records))`. Skipped test cases are injected by replacing `evidenceReadState` first (replacing it resets `evidenceRecordsState`). The check of SR-025 AK4 (`hints/evidence.ts`) reads it.

## Index

`evidenceIndex(records, skipped)` (`by-element.ts`), and `evidenceIndexState` (from `evidenceRecordsState` and the `skipped` of `evidenceReadState`). Pure: matching against the store (unknown elements, current versions) belongs to the consumers.

- `byElement`: the records of each element, newest first (`newestFirst`: `date` as an instant, an unreadable date the oldest, then repository, file, line).
- `testCases`: every test case by key (`TestCaseEntry`: name, class name, the elements it names, all its records newest first), ordered by class name, then name.
- `testCasesOf(id)`: the test cases that name the element, each seen from it (`TestCase`).
- `hasVerificationRecord(index, id, view)`: at least one verification record in the view (core: a record without variant; a variant: a record for it, SR-047). The one definition of "has evidence" ("ohne Nachweis", SR-069 AK3; the `no-evidence` gap, SR-022 AK3; coverage, SR-036) for the filter, the chain and the coverage (plan review S4). Version and result do not count (spec question #527).

## Markdown reader

SR-028 (#40).

## JUnit reader

SR-093 (#105); the XML scanner and the JUnit model are `files/xml-scan.ts` and `evidence/junit-model.ts` (E2, ADR-0012 "JUnit XML").

## Writing records

`evidence.record` (SR-030) and `evidence.enrichJunit` (SR-029).
