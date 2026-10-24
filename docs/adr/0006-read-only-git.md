# ADR-0006: Read Git through the git program, read-only

Status: Proposed · Based on: D-014, D-024, D-036, D-039 · SRs: SR-050, SR-051, SR-062, SR-083, SR-092

## Context

LogReq reads Git for the state (commit per repository), the date of a version, uncommitted changes before a baseline (SR-050 AK2), files changed in a merge request (SR-092 AK1) and old file contents (SR-051, ADR-0005). It never commits, pushes, pulls, merges or switches branches (D-036, SR-083).

## Decision

- Use the installed **`git` program** through one module `core/src/git/reader.ts`. It is the only place that spawns processes.
- The module accepts only an allowlist of subcommands with fixed argument shapes: `rev-parse`, `cat-file`, `show <rev>:<path>`, `log` (with `--format`, path limits), `diff --name-only`, `ls-files`, `status --porcelain=v2`. Anything else is a programming error.
- Every call sets `GIT_OPTIONAL_LOCKS=0` (so `status` does not refresh the index), `GIT_TERMINAL_PROMPT=0`, `-c core.fsmonitor=false`, and `--no-pager`; no network operation is on the allowlist.
- A test runs a full scenario and then compares `.git` (refs, HEAD, index, objects count) before and after: nothing may change (SR-083 AK1). Another test asserts the allowlist (SR-083 AK3).
- If `git` is missing or a folder is not a repository, Git-based information is shown as unknown; everything else works (SR-077: no network needed; the app stays usable).
- Comparing a baseline with today (SR-051 AK3) returns the commits and the `git diff` command; the app opens it in the configured Git tool or a terminal. LogReq does not render diffs itself (D-033).

## Consequences

- Works with every Git feature (worktrees, SHA-256 repositories, partial clones) because Git itself reads them.
- `git` (2.30 or newer) becomes a runtime requirement for Git-based information; documented in the installation guide.
- Paths from Git and paths of element files may differ in their Unicode normal form. The element walk reports a file under the name `readdir` gives (NFD on HFS+, or as a macOS tool stored it), while `git` on macOS with `core.precomposeUnicode=true` (the default there) reports NFC. Wherever the reader joins its paths to element files (uncommitted changes, SR-050 AK2; files changed in a merge request, SR-092 AK1; old contents, SR-051), it compares both in NFC, as the `ignore` globs do (#218).

## Rejected

- `isomorphic-git`: no external program needed, but slower on large histories and incomplete for newer repository features; also contains write and network code we would have to keep unused.
- `libgit2` bindings (nodegit): native builds per platform and Electron version.
