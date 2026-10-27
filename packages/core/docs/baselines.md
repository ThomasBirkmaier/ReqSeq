# Baselines block (`src/baselines/`)

Part of the [`@logreq/core` README](../README.md). Baseline files (D-039, `baseline.schema.json`): stage 4 has the read-only reader (`read.ts`) so that `evidence.list` can name the baselines that contain the version of a record (SR-032 AK2, assumption of spec question #530 Q1). Creating, comparing and selecting by baseline is stage 5 (SR-050, SR-051; `selection.baseline` is refused until then). The block never writes and never runs Git.

## Reading

`readBaselines(layout, kept?)` → `{ location, baselines, problems, incomplete }`:

- Where: the `baselines` location of the workspace file, default the folder `baselines` in the main repository (`settingLocation`). Every `*.yaml` file directly in the folder, in file order (code units), as saved filters are read; the workspace file is never one. A `.yml` file is `baseline.invalid` (warning) and not read; other files (a README) are passed over; a folder that does not exist holds no baseline; a path that is no folder is `file.unreadable`.
- A file is checked against `baseline.schema.json`: YAML errors are the problems of `readYamlFile` (`file.invalid-yaml`, ...); a schema violation is `baseline.invalid` (error) with the line of the value, at most `MAX_VIOLATIONS` per file and then one problem that counts the rest. A faulty file gives no baseline.
- `Baseline`: `name`, `repository`, `file` and `contains(id, version)`: the file lists the element's UUID with that version (in any repository; `elements[].repository` names a copy, SR-088).
- `incomplete`: the repository of the folder is not on this machine (SR-006 AK2). A location in a repository the workspace file does not list gives nothing (the layout reports it).
- `baselinesContaining(baselines, id, version)`: the names of the baselines that contain the version, in file order, each name once.

## Kept between calls

`baselineFilesState` (reset with the workspace layout) keeps what each file gave with its size and modification time. `workspaceBaselines(workspace)` lists the folder on every call and parses again only a file that is new or whose size or time changed, and drops files that are gone. So a baseline committed by another person counts as soon as the working copy has it, also in a running server or the app, and a baseline of 50,000 elements is parsed once (N-036).
