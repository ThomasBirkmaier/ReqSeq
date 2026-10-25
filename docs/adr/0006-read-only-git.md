# ADR-0006: Read Git through the git program, read-only

Status: Proposed · Based on: D-014, D-024, D-036, D-039 · SRs: SR-050, SR-051, SR-062, SR-083, SR-092

## Context

LogReq reads Git for the state (commit per repository), the date of a version, uncommitted changes before a baseline (SR-050 AK2), files changed in a merge request (SR-092 AK1) and old file contents (SR-051, ADR-0005). It never commits, pushes, pulls, merges or switches branches (D-036, SR-083).

## Decision

- Use the installed **`git` program** through one module `core/src/git/reader.ts`. It is the only place that spawns processes.
- The module accepts only an allowlist of subcommands with fixed argument shapes: `rev-parse`, `cat-file`, `show <rev>:<path>`, `log` (with `--format`, path limits), `diff --name-only`, `ls-files`, `status --porcelain=v2`. Anything else is a programming error. Paths and object names go to standard input, one per line (`log --stdin`, `cat-file --batch-command`, `--batch`, `--batch-check`), so no command line gets too long on Windows and no path can be read as an option; the only argument after a fixed command line is a checked commit ID. Old contents are read with `cat-file` (`<commit>:<path>`), which does what `show <rev>:<path>` does for many objects in one process (#260): one `cat-file --batch-command --buffer` process answers all rounds of `info` and `contents` of a call (git 2.36 and newer); a git that refuses the option (exit code 129 before any output) gets one `cat-file --batch-check --buffer` or `--batch --buffer` process per round, and the reader remembers that while the program runs.
- Every call sets `GIT_OPTIONAL_LOCKS=0` (so `status` does not refresh the index), `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1` (a path is never a glob or `:(magic)`), `GIT_NO_LAZY_FETCH=1` (a partial clone does not fetch a missing object; git 2.44 and newer), `-c protocol.allow=never` (git may use no transport at all, so a partial clone cannot fetch a missing object with an older git either; the object is then unknown), `-c core.fsmonitor=false`, and `--no-pager`; no network operation is on the allowlist. `log` runs with `--no-show-signature` (no GPG) and `--no-follow`; `cat-file` without `--filters` (no checkout filter programs).
- **HEAD from the files of the Git folder** (#260, so that opening an element starts no `rev-parse`): `headFiles` reads, and never writes or locks, the few small files that name HEAD: the `.git` file of a linked worktree or submodule (`gitdir:`), `HEAD`, `commondir`, the branch file under `refs/heads/` or else its line in `packed-refs`, and `shallow`. It gives the commit and a stamp of these files (content, or identity, size and change time); while the stamp stays the same, so does HEAD, and the version date keeps its walks. Where these files cannot tell (a `reftable` folder, a HEAD that names no branch or commit, a branch file that names another branch, no Git folder), the caller runs `rev-parse` as before. It reads no object and no other file.
- A test runs a full scenario and then compares `.git` (refs, HEAD, index, objects count) before and after: nothing may change (SR-083 AK1). Another test asserts the allowlist (SR-083 AK3).
- If `git` is missing or a folder is not a repository, Git-based information is shown as unknown; everything else works (SR-077: no network needed; the app stays usable).
- Comparing a baseline with today (SR-051 AK3) returns the commits and the `git diff` command; the app opens it in the configured Git tool or a terminal. LogReq does not render diffs itself (D-033).

## Consequences

- Works with every Git feature (worktrees, SHA-256 repositories, partial clones) because Git itself reads them.
- `git` (2.30 or newer) becomes a runtime requirement for Git-based information; documented in the installation guide. What the options need: `%cI` 2.2, `cat-file --buffer` 2.5, `--no-show-signature` 2.10, `protocol.allow` 2.12, `rev-parse --is-shallow-repository` and `GIT_OPTIONAL_LOCKS` 2.15, all below 2.30. Newer than 2.30, each with a fallback: `cat-file --batch-command` 2.36 (older: one process per round, above), `GIT_NO_LAZY_FETCH` 2.44 (older: ignored, and `protocol.allow=never` still holds).
- Paths from Git and paths of element files may differ in their Unicode normal form. The element walk reports a file under the name `readdir` gives (NFD on HFS+, or as a macOS tool stored it), while `git` on macOS with `core.precomposeUnicode=true` (the default there) reports NFC. Wherever the reader joins its paths to element files (uncommitted changes, SR-050 AK2; files changed in a merge request, SR-092 AK1; old contents, SR-051; the version date, ADR-0005), it compares both in NFC, as the `ignore` globs do (#218). Where it asks Git for a path, it passes the path as spelled and its NFC and NFD forms, since Git compares paths exactly. A path whose folder and file names Git stores in different forms is therefore found only as spelled (ADR-0005 "Embedded images at an old commit").

## Rejected

- `isomorphic-git`: no external program needed, but slower on large histories and incomplete for newer repository features; also contains write and network code we would have to keep unused.
- `libgit2` bindings (nodegit): native builds per platform and Electron version.
