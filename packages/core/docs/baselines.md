# Baselines block (`src/baselines/`)

Part of the [`@reqseq/core` README](../README.md). Baseline files (D-039, `baseline.schema.json`): stage 4 has the read-only reader (`read.ts`) so that `evidence.list` can name the baselines that contain the version of a record (SR-032 AK2, assumption of spec question #530 Q1). `data.export` selects by baseline (SR-061 AK2, `selects` and `findBaseline` below); creating and comparing baselines, and selecting by baseline in other commands, is stage 5 (SR-050, SR-051, SR-094; the other commands refuse `selection.baseline` until then). The block never writes and never runs Git.

## Reading

The file format, the fast reader and the bounds are [ADR-0018](../../../docs/adr/0018-baseline-file.md). A file in the layout ReqSeq writes is read by the line scanner (`scan.ts`: `scanBaseline`, and `baselineHeader` for the lines before `repositories:`, with the `selection.ids` lines scanned too), through `readYamlFileFast` of the files block; any other layout (a comment, a blank line, CRLF, a BOM, entries out of order) falls back to YAML and the schema, with the same baseline or the same problems. On both paths an element copy or a repository listed twice is `baseline.invalid` at the line of the second one.

`readBaselines(layout, kept?)` → `{ location, baselines, problems, faulty, incomplete }`:

- Where: the `baselines` location of the workspace file, default the folder `baselines` in the main repository (`settingLocation`). Every `*.yaml` file directly in the folder, in file order (code units), as saved filters are read; the workspace file is never one. A `.yml` file is `baseline.invalid` (warning) and not read; other files (a README) are passed over; a folder that does not exist holds no baseline; a path that is no folder is `file.unreadable`.
- A file is checked against `baseline.schema.json`: YAML errors are the problems of `readYamlFile` (`file.invalid-yaml`, ...); a schema violation is `baseline.invalid` (error) with the line of the value, at most `MAX_VIOLATIONS` per file and then one problem that counts the rest. A faulty file gives no baseline.
- `Baseline`: `name`, `repository`, `file` and `contains(id, version)`: the file lists the element's UUID with that version (in any repository; `elements[].repository` names a copy, SR-088). `selects({ id, repository })` (`data.export`): the file lists the UUID in any version, an entry with `repository` for that copy only, one without for every copy; one index per file read, kept with it. Taking an entry without `repository` as every copy is the interim rule: ADR-0018 takes it as the copy in the file's repository, else the only copy, and `baselineOf` follows with SR-051.
- `faulty`: the files that gave no baseline, relative to their repository, in file order.
- `findBaseline(baselines, text)` → `found`, `ambiguous` (the files), `faulty` (the file) or `none`: by `name` first (ignoring case and Unicode normal form, as saved filters), then by file name in the folder with or without `.yaml` (the folder is configurable, so no folder part); a text that names only a faulty file by its file name is `faulty`.
- `incomplete`: the repository of the folder is not on this machine (SR-006 AK2). A location in a repository the workspace file does not list gives nothing (the layout reports it).
- `baselinesContaining(baselines, id, version)`: the names of the baselines that contain the version, in file order, each name once.

## Kept between calls

`baselineFilesState` (reset with the workspace layout) keeps what each file gave with its size and modification time. `workspaceBaselines(workspace)` lists the folder on every call and parses again only a file that is new or whose size or time changed, and drops files that are gone. So a baseline committed by another person counts as soon as the working copy has it, also in a running server or the app, and a baseline of 50,000 elements is parsed once (N-036).

## Text of a new file

`baselineText(data)` (`text.ts`) writes the layout of ADR-0018 that `scanBaseline` reads: the header in block style with `package`, `view` and `ids` items as flow mappings and lists of plain values in `where` on one line, then one flow mapping per line for `repositories` and `elements` (`elements: []` when empty); a repository name YAML would read as no string is quoted. `baselineStem(name)` is the file name without extension: `portableName` with `baseline` when nothing is left, `-baseline` after a Windows device name.
