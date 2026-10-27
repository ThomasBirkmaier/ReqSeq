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

`evidenceProblemsState` (`match.ts`, below) shows the problems in `workspace.check`.

## State

- `evidenceReadState` (`state.ts`, depends on `workspaceLayoutState`): `readEvidence(layout, readers)`: the files of `evidenceFiles`, each given with its bytes to the reader of its extension, 16 at a time; `{ records, skipped, problems, incomplete }`. A file without a reader is not read; one that cannot be read is `file.unreadable`.
- `EVIDENCE_READERS`: one `EvidenceReader` (`{ extension, read(file, bytes) }`) per extension: `MARKDOWN_READER` (`md`, SR-028) and the JUnit reader (`xml`, SR-093). A reader reads nothing else and gives nothing for a file that is no record of its kind.
- `evidenceRecordsState` (depends on `evidenceReadState`): the records alone, an array. It is the seam through which tests and consumers get records without files (#127 option 1): `workspace.replace(evidenceRecordsState, current, Promise.resolve(records))`. Skipped test cases are injected by replacing `evidenceReadState` first (replacing it resets `evidenceRecordsState`). The check of SR-025 AK4 (`hints/evidence.ts`) reads it.

## Index

`evidenceIndex(records, skipped)` (`by-element.ts`), and `evidenceIndexState` (from `evidenceRecordsState` and the `skipped` of `evidenceReadState`). Pure: matching against the store (unknown elements, current versions) belongs to the consumers.

- `byElement`: the records of each element, newest first (`newestFirst`: `date` as an instant, an unreadable date the oldest, then repository, file, line; `sortNewestFirst` parses each date once).
- `testCases`: every test case by key (`TestCaseEntry`: name, class name, the elements it names, all its records newest first), ordered by class name, then name.
- `testCasesOf(id)`: the test cases that name the element, each seen from it (`TestCase`), from the records per element each entry keeps (`recordsOf`), so a call costs the test cases of the element and their executions, never the records of other elements; built once per element and kept.
- `hasVerificationRecord(index, id, view)`: at least one verification record in the view (core: a record without variant; a variant: a record for it, SR-047). The one definition of "has evidence" ("ohne Nachweis", SR-069 AK3; the `no-evidence` gap, SR-022 AK3; coverage, SR-036) for the filter, the chain and the coverage (#535). Version and result do not count (spec question #527).

## Markdown reader

SR-028 (#40). `readMarkdownRecord(file, bytes)` (`markdown.ts`), registered as `MARKDOWN_READER` for `md`: one record per Markdown file whose frontmatter has the key `logreq-record` (`RECORD_KEY`), checked against `evidence-record.schema.json` (`fileSchemaValidator`).

- The bytes are parsed as an element file is (`parseFileBytes`: strict UTF-8, BOM, CRLF, conflict markers, YAML 1.2). A file that does not parse gives the problem of the files block (`file.invalid-yaml`, `file.conflict-markers`, `file.unreadable`, with the repository) and no record.
- A file without frontmatter, or whose frontmatter is no mapping with `logreq-record`, is no record (a README in an evidence folder): nothing, not even its YAML warnings. A record keeps its YAML warnings (`file.yaml-warning`).
- A key the format does not know: warning `evidence.invalid-record` naming the key, at its line; the record counts without it (spec question #533 Q1, assumption: as D-012 does for unknown properties of elements).
- Any other violation (a required key missing, a wrong value, `logreq-record` other than 1): error `evidence.invalid-record` per violation, at the line of its key (1 for a missing key); the file gives no record, and the warnings on unknown keys say so.
- The lines of the keys come from `keyLinesOf` of the model block (one pass over the frontmatter, also for thousands of keys); the problems of a file are in line order.
- The record: the frontmatter without `logreq-record`, `test-case` as `testCase`, `source: markdown`, the repository and file, `line: 1`.

## Findings

`evidenceProblemsState` (`match.ts`; depends on the layout, the element store, `evidenceReadState` and `evidenceRecordsState`) is the evidence entry of `FINDING_STATES` in `workspace.check`, after the cycles and before the outdated evidence (SR-025 AK4):

- the problems of `evidenceReadState` (walk and readers), without those the element store reports for the same code, repository, file and line: the store reads every Markdown file of every available repository, evidence folders included, so a record with broken YAML shows once;
- `recordElementProblems(records, store, layout)` over the records of `evidenceRecordsState` (injected ones too), in their order: `evidence.unknown-element` (warning, SR-028 AK3) for a UUID the store does not have, with a note naming the repositories that are not on this machine; `evidence.ambiguous-element` (warning) for a UUID with several copies (SR-088). Both carry the record's repository, file and line and the UUID as `targetId`, never as `elementId`: they are about the record, not confirmable and not in `hint.list` (spec question #533 Q2, assumption).

Nothing here needs the metamodel, so the findings show while it is not valid.

## JUnit reader

SR-093 (#105). `readJunitRecords(location, bytes)` (`junit.ts`), registered as `JUNIT_READER` for `xml`: the records of an enriched JUnit XML file, read with the XML scanner and the JUnit model (`files/xml-scan.ts`, `evidence/junit-model.ts`, E2, ADR-0012 "JUnit XML"). It reads the bytes only, never the element store: whether a UUID names an element of the workspace is the consumers' question (`evidence.unknown-element`, SR-028).

- A test case is enriched when it has a `logreq:version` property. Its `logreq:element` properties (UUIDs, any case, kept in lower case) name the requirements, and the n-th `logreq:version` is the version of the n-th `logreq:element`; `logreq:item` and `logreq:date` are required, `logreq:variant` is optional (absent: the core). It gives one record per element (a repeated element with the same version once, with two different versions `evidence.invalid-record`; SR-033 AK2): kind `verification`, method `test`, result `failed` with `<failure>` or `<error>`, else `passed`, `testCase` the JUnit `name`, `className` the `classname` (left out when empty), `source: junit`, the repository, file and line of the `<testcase>`.
- A test case that names no requirement (no `logreq:element` property, no short ID or UUID token in its name) is passed over without a problem (AK2). A pytest parameter list (`test_add[1-2]`) or an identifier in brackets (`[SR-036]`) is no reference the reader can tell without the store, so it is passed over too.
- A test case that names a requirement but has no `logreq:version` gives no record. The file gets one `evidence.not-enriched` warning with the number of such test cases and the line of the first (spec question #529 Q3), not one per test case, so an unenriched CI file of thousands of test cases gives one line.
- An enriched test case marked `<skipped>` gives no record, so it never counts as passed (AK3); it is a `SkippedTestCase`, a test case without execution (SR-033 AK3).
- An enriched test case whose properties do not fit gives no record and an `evidence.invalid-record` error with its line: a `logreq:element` that is no UUID (a short ID left by hand: enrich writes the UUID, #529 Q4), element and version counts that differ, an element given twice with different versions, a malformed version, item, date or variant, or item, date or variant given twice with different values. A file the scanner refuses is `evidence.invalid-record` with the scanner's line; XML whose root is not `testsuites`/`testsuite` gives nothing.
- Problems of a file come by line. `evidenceProblemsState` (SR-028, "Findings" above) shows them in `workspace.check`.
- Cost: linear in the file; the JUnit model is most of it (a 29 MB file with 50,000 enriched test cases reads in a few seconds). Memory is the larger risk: the model holds about 17 times the file (an 18 MB file, 313 MB heap), and `readEvidence` reads 16 files at a time, so many large CI files at once can need several GB. E4 measures peak heap next to time and, if needed, lowers the concurrency for `xml` or bounds the bytes in flight.

## Writing records

`evidence.record` (SR-030) and `evidence.enrichJunit` (SR-029).

### Enriching JUnit XML

SR-029 (#41). `evidence.enrichJunit` (`enrich.ts`, ADR-0012 "Enriching"): `enrichJunitBytes(bytes, options)` is pure (the resolver and the current versions are injected; it reads and writes no file); `enrichJunitFile(workspace, input)` reads, resolves against the store, writes and resets the evidence state. Per test case:

1. **References**: each `logreq:element` property on its own, in file order (a repeated one gets its own version), then the name tokens (`elementRefsOf`), each resolved with `resolveRef`. A property that names no element or more than one is reported, whatever its form; an empty one too. A name token of the form of a short ID or UUID is reported the same way; any other name token (`[SR-036]`, `test_add[1-2]`) counts only when it names exactly one element. Elements a property names already are not added again.
2. **Reported references**: the test case stays unchanged; `unknown` gets `{ testCase, className?, line, ref }` and `problems` an error `evidence.unknown-element` or `evidence.ambiguous-element` (`Test case "<name>" (line <n>): …`, the candidates for an ambiguous one, and a note when a repository is not on this machine). The other test cases are enriched and the file is written (spec question #529 Q1); the errors make the CLI exit with 1.
3. **Already enriched** (a `logreq:version` property): never changed, so the version stays the one tested (D-026, spec question #529 Q5, assumption "keep"). It counts in `testCases`; a kept version that is no longer current gives `evidence.outdated` (warning), a UUID the workspace does not have (or has twice) `evidence.unknown-element` (`evidence.ambiguous-element`, warning), and one the reader rejects `evidence.invalid-record` (error).
4. **Versions**: `currentVersionsOf` for the elements named only (a fresh CLI process reads only their files). An element without one gives `file.faulty` (error, `elementId`); the test case stays unchanged.
5. **Values**: every `logreq:element` becomes the UUID in place; one `logreq:version` per element, in the same order; `logreq:item` the input; `logreq:date` the input, else an existing valid one, else the `timestamp` of the nearest suite when it has a time zone (spec question #529 Q2), else the time of the call. Existing `logreq:item` and `logreq:date` are replaced in place (at `valueAt`, or the whole property when it has no value), never written twice. No `logreq:variant` is written; an existing one that is no UUID is `evidence.invalid-record`.
6. **Where**: a new element right after the last `logreq:element`, the rest at `propertiesAt`. In a block on lines each new property goes on a line of its own with the indentation and line ending of the property before it; otherwise inline, and a new `<properties>` block goes on the line of the `<testcase>` start tag (pytest's one-line files stay one line). Every other byte stays.
7. **Escaping**: attributes escape `& < >`, the quote, tab, line feed and carriage return (as `&#9; &#10; &#13;`, so they survive attribute normalisation); element text escapes `& < >` and carriage return. The catalog refuses an item with white space at either end or with control characters other than tab, line feed and carriage return, which XML 1.0 cannot hold.
8. **Read back** (ADR-0007 pattern, `checkReadBack`): every splice lies inside the test case it enriches, so the bytes outside the enriched test cases must be byte for byte those read (the other test cases among them), and each enriched `<testcase>` element, scanned on its own (`readsBackAs`), must be one test case with the same name, class name and outcome and exactly the intended elements, versions, item and date by the reader's checks (`enrichmentOf`). No model of the whole result is built (S1 of the PR review). Any difference is `internal`, nothing written. The output is built with one `Buffer.concat` of slices.
9. **Files**: `file` and `output` are local paths (ADR-0009). A missing input or one that is not a regular file is `input.invalid` (base name only), one the scanner refuses `file.faulty`, XML whose root is no JUnit root `input.invalid`. The file written (input or `output`) must not lie in a `.git` folder: its real folder is checked, case-insensitively (D-036). It is written with `writeFileAtomic(dirname, basename, bytes, snapshot, { kind: "xml" })`: in place only while its bytes are those read and still scan; an existing `output` only when it is a JUnit file (`readFileSnapshot`, its own snapshot), else `file.faulty`; a missing `output` is created; a missing folder is `file.folder-missing`. Nothing to change: the input is not rewritten (`files: []`); a given `output` is still written (the input bytes), unless it holds exactly these bytes already (`files: []`, its time kept).
10. **Paths**: `files` and the problems' `file` are relative to the workspace root (the folder of the main repository) with `/` when the file lies below it or in another repository of the workspace (as `workspacePath`; the layout gives the repository folders as real paths), else absolute; the same on every access. After a write `evidenceReadState` is reset, so app, API and MCP see an enriched file in an evidence folder at once (E3 adds outside changes).

Cost (S5 of the plan review, S1 of the PR review; measured on one machine, Node 22 with its default heap of about 2.2 GB): pytest-style files whose test cases each name a requirement: 42 MB with 250,000 test cases in about 23 s with a peak of about 1.4 GB resident memory; 77 MB with 450,000 in about 57 s and 1.8 GB; 102 MB with 600,000 in about 83 s and 2.0 GB, close to the limit. The scanner model of the file as read is most of it (it holds about 17 times the file); the read-back builds no second model of the whole result: it compares the bytes outside the enriched test cases with the file as read and scans each enriched test case on its own. Practical ceiling on a default heap: about 100 MB of JUnit XML; for a larger file raise the heap, e.g. `NODE_OPTIONS=--max-old-space-size=8192`. Beyond that the process stops with an out-of-memory error before anything is written (the input stays unchanged, no temporary file is left). No streaming yet; E4 measures it with the other evidence paths.
