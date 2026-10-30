# ADR-0018: Baseline file

Status: Proposed · Based on: D-006, D-036, D-039, D-045, D-058, N-036 · SRs: SR-050, SR-051, SR-094, SR-103 · Schema: `schemas/baseline.schema.json`

## Context

D-039 makes a baseline a file that ReqSeq writes and a person commits, and leaves its format to an ADR. Stage 4 reads such files (SR-032 AK2, `baselines/read.ts`); stage 5 creates them (SR-050), shows and compares them (SR-051, SR-094) and finds the newest baseline of a variant (SR-103). A baseline of 50,000 elements is about 4 MB; YAML parses it in about 1.9 s, and the CLI, the API and MCP start cold, so a command that looks at 20 such files would spend 40 s in YAML (N-036).

## Decision

**Place.** The folder the workspace file names for baselines, else `baselines/` in the main repository (`settingLocation`); files directly in it, `.yaml` only. Every `repository` in the file (in `selection` and `elements`) is relative to the repository that holds the baseline file, as D-058's title rule; the workspace file may put the folder into another repository than the main one.

**Name and file name.** `name` is `baseline.schema.json#/$defs/name` (at most 200 characters, no leading or trailing space, no control characters, as a saved filter's name), also the input of `baseline.create`. The file name is the name made portable as attachment names (ADR-0004: NFKD without combining marks, other runs of characters `-`, at most 64 characters, `-baseline` after a Windows device name), case kept, plus `.yaml`; when nothing is left it is `baseline.yaml`. A file name the folder has in any case or Unicode normal form gets `-2`, `-3`, … before `.yaml`, as attachments and saved filters (`newFilterFile`), so no name is refused for its file name. „Release 1“ gives `Release-1.yaml`; NFKD keeps `ß`, so „Größe“ gives `Gro-e.yaml`; „基线一“ gives `baseline.yaml` and „基线二“ then `baseline-2.yaml`.

**Never overwritten** (SR-050 AK6, D-045). `baseline.create` refuses with `baseline.exists` (conflict: exit 2, HTTP 409; `details.file`, `details.repository`) only when a valid baseline has the name (case and normal form folded, `findBaseline`), naming its file. It writes through the create path of `files/write.ts` (temp file and hard link to the target, exclusive create where links are not supported); when that reports „already exists“ (a file that appeared meanwhile), it takes the next suffix. ReqSeq never changes or removes a baseline file afterwards and never commits it (D-036).

**Layout.** This is the contract of the fast reader below, and the writer always writes it:

```yaml
reqseq-baseline: 1
name: Release 1
date: 2026-11-02T13:00:00Z
selection:
  view: { id: ca0dd4a9-6f1e-4c3a-9d55-2b7c1e8f0a11, title: Pro }
repositories:
  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }
  - { name: sensor, commit: 1f2a6c3b9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4a }
elements:
  - { id: 102ee39b-773f-4cd0-b414-825b7146fb54, version: n1:fcde2b2edba56bf4 }
  - { id: fe5fce30-087e-4bbd-82e4-0f03900e5af3, version: n1:e3b0c44298fc1c14, repository: sensor }
```

- The header keys first and in this order: `reqseq-baseline`, `name`, `date`, `selection`; then `repositories`, then `elements` (`elements: []` when empty, SR-050 AK5).
- `repositories` and `elements` one flow mapping per line, keys in the order `id`, `version`, `repository` (`name`, `commit`); `selection.ids` a block list directly below `selection:` (`  ids:`), one item per line: a UUID, or `{ id, repository }`.
- LF, UTF-8 without BOM, final newline; `name` quoted only where YAML needs it.

**`date`.** RFC 3339 in UTC without fractions, from the clock of the command context, as `evidence.record` writes records and as `recordDate` and `versionDate` are (ADR-0012). The day of a baseline „as written in its file“ (SR-094 AK2) is therefore its UTC day: a baseline made at 00:30 CET carries the previous day.

**`selection`** (`$defs/storedSelection`), read by SR-051, SR-094 and SR-103, so no longer „for information“:

- Written only in canonical form: `where` as `filter.save` writes it (`canonicalCondition`). A saved `filter` is resolved: its `where` (with the input's `where` under `all`) and its `view` are written, never its name, so a later change of the filter does not change the baseline. A saved filter that holds only a view is stored as `{ view: A }` and so counts as a baseline of A.
- `package` and `view` as `{ id, title }` when the element lies in the repository of the baseline file, `{ id, repository }` otherwise (D-058); the title is the one at baseline time, for people who read the file without ReqSeq. `ids` items carry no title: a UUID in the file's repository, `{ id, repository }` otherwise, so a selection of 50,000 IDs is read line by line like `elements`. `view: core` stays the text. `selection.baseline` is refused (`input.invalid`).
- `reqseq-baseline: 1` stays. The reader accepts every `elementRef` (UUID, short ID, identifier) for `ids`, `package` and `view`, and a saved `filter` by name (the stage 4 example), resolved in the command layer; a file with a `filter` name has `selectionKnown: true` and is read with the filter as it is now. A file that fails the stricter schema is `baseline.invalid`, with no compatibility rule (product owner decision, 2026-10-29): a `name` over 200 characters, with a leading or trailing space or a control character, a `selection.baseline`, and a repeated element copy or repository.

**`repositories`.** The repositories of the selected elements, the main repository and the metamodel's, each once (a name listed twice is `baseline.invalid`), in the order of the workspace file, each with its HEAD commit (SR-050 AK4). A repository involved that is not under Git or has no commit refuses the baseline with `git.unavailable` (AK7).

**`elements`.** Sorted by `id`, then `repository`, by code units (none first); each element copy once. An entry listed twice, also once without `repository` and once with the file's own repository, is `baseline.invalid` with the file and the line of the second entry. The writer writes `repository` when the element lies outside the repository of the baseline file, or when its UUID has copies in several repositories (SR-088). The reader takes an entry without `repository` as the copy in the repository of the baseline file, else, when the UUID has no copy there, as its only copy; with several copies elsewhere the entry is `baseline.invalid` (ambiguous) instead of matching every copy (`baselineOf` follows with SR-051).

**Reading (N-036).** No cache on disk; two readers of the canonical layout, and YAML as fallback (`baselines/scan.ts`, `files` `readYamlFileFast`):

- *Header read* (`baselineHeader`): the text up to the line `repositories:`; the `selection.ids` lines are read line by line as below, the rest is parsed with YAML and checked against the header properties of the schema. It finds the candidates for the newest baseline of a variant (SR-103 AK4, for `hint.list`, `workspace.check`, `element.get`); the chosen file is then read in full, which SR-103 needs anyway to compare versions, and a faulty one is no baseline (`baseline.invalid`), so the next newest is taken.
- *Line scanner* (`scanBaseline`): the header as above, then `repositories` and `elements` line by line, one anchored pattern per line that checks what the schema checks for an entry (UUID, version, commit, repository name, no other key) and refuses a plain value YAML would read as no string (`123`, `true`).
- Any line that does not match, a comment, a blank line, CRLF, a BOM, a YAML warning in the header, an entry out of order or twice sends the whole file to the fallback: YAML plus schema validation, with the same data and the same problems with lines. Then both paths check for repeated entries and repositories. Tests read the examples and a set of hand-edited files both ways and compare.
- `baseline.list` reads every file with the line scanner, so its validity and its number of elements are exact, also for hand-edited files, which take the fallback.
- Measured in a cloud container: the scanner reads a file of 50,000 entries (4 MB) in 35 to 40 ms, about 130 ms in a cold process; YAML alone takes about 1.6 s. Only hand-edited files pay the fallback.
- `baselineFilesState` keeps what each file gave by change stamp in the app and a running server, as before.

**Which baseline.**

- A baseline of variant A (SR-103 AK4) is one whose stored selection has exactly the key `view` and names A, in any readable form, resolved.
- The newest one is the one with the latest `date` instant, date and time; at the same instant the last in file order (code units of the file name). Assumption, spec question #403: „jüngstes Datum“ in SR-103 AK4 means date and time as in SR-094 AK2 („Verglichen werden Datum und Uhrzeit“), not the day.

**Git** (ADR-0006). Create, get and compare use only the allowlist. The check for uncommitted changes (SR-050 AK2) uses `changedPaths` against HEAD and the blob comparison of `data.export`; a state file without a blob at HEAD counts, so a never committed or ignored file refuses the baseline; evidence records do not count. `baseline.compare` runs nothing: it returns both commits and `["git", "-C", <repository folder relative to the workspace root>, "diff", from, (to), "--", (oldFile), file]`, run in the workspace root, `/` as separator, the same on every access. A file moved since the baseline commit is found through `changedPaths` and the UUID read with `cat-file` at that commit (no `ls-tree`, no rename detection).

**Contract changes.** Inputs: `baseline.create` `name` gets the constraints of `$defs/name`, also for the file; `baseline.get` gets `limit` and `offset` (its `elements` is one paged list: the file's entries, then the added elements) and `withEvidence` a default. Outputs of `baseline.create`, `baseline.list`, `baseline.get` and `baseline.compare` change; no stage implements them yet. New error code `baseline.exists`; new hint codes `variant.core-changed-since-baseline` (SR-103 AK1) and `variant.core-new-since-baseline` (AK7), which carry no `hintId`: they cannot be confirmed and go with a new baseline of the variant (AK5). New completion source `baseline` (ADR-0002 rule 1), mapped to `baseline.list`. The layer table allows `hints → baselines` (architecture §5).

**Performance bounds** (N-036), measured cold (one new CLI process per call, model cache present, `baselineFilesState` empty) on the generated workspace of 50,000 requirements with 4 cores, in the nightly `packages/core/test/perf/baselines.test.ts`:

| Call | Bound |
|---|---|
| `baseline list`, 20 files of 50,000 entries | ≤ 1.5 s beyond the CLI start |
| `baseline list`, 20 files of 50,000 entries and an `ids` selection of 50,000 each | ≤ 2.5 s beyond the start |
| `hint list --variant A`, 20 baselines of A (header reads), the newest of 50,000 entries read in full | ≤ 1 s beyond the start |
| `workspace check`, 50 variants each with a newest baseline of 50,000 entries and one older | the baseline part ≤ 10 s, within ADR-0008's ≤ 60 s |
| `element get` of A with 5,000 since-baseline hints, running server | ≤ 200 ms (SR-082 AK3) |
| `baseline create` | ≤ 3 s |

The test also records the fallback time of one hand-edited file of 50,000 entries (about 2 s, no bound). `baseline.get` reads version dates for its page only; the state of an entry is O(1) from the current versions, `added` one pass over the selection.

## Consequences

- A baseline file is readable without ReqSeq: titles next to UUIDs, one element per line, so `git diff` of two baselines shows the change line by line.
- A hand-edited file stays valid; it is only read more slowly.
- The writer and the scanner share one layout; a change to the layout changes both and the tests that read both ways.

## Rejected

- A cache of parsed baselines by change stamp in the cache folder (ADR-0008): it needs invalidation and a copy of the selection on disk, and the scanner meets the bounds without it.
- `selection.ids` after `elements`, outside the header: it splits the selection in two places of the file; scanning the `ids` lines in place keeps one `selection`.
- Refusing a name whose portable file name is taken: names in Cyrillic, Greek or CJK all become `baseline.yaml`, so only one of them could ever exist, while SR-050 AK6 refuses only an equal name.
- JSON or JSON Lines baselines: faster to parse, but baseline files are `.yaml` (D-056), and a reviewer reads a YAML baseline in the merge request.
- Header and elements in two files: two files to commit together, and a moved or half-committed pair breaks the baseline.
