#!/usr/bin/env bash
# Reads changed paths (one per line, as `git diff --name-only --no-renames` prints them) and prints `true`
# when the heavy checks must run (build, unit tests, spec:check and e2e in `checks`, the Electron tests in
# `electron`, and `perf`), `false` when every path is one that no test, build or check reads except the static
# checks and trace-check, which run on every pull request (#520, #566). CI runs the base branch's copy of this
# script, so a pull request cannot classify itself with a changed copy.
#
# Safe paths, checked against the tests and scripts:
# - docs/**          ADRs and architecture: read by people and agents only.
# - .claude/**       agent rules and skills.
# - verification/**  records: read by trace-check only (the Electron screenshots go to test-results/).
# - toolchain/**/*.md, *.md at the root (README.md, CLAUDE.md).
# Everything else needs the tests: spec/ (Electron graph tests, screenshots, spec:check), fixtures/
# (fixtures/README.md is read by a testkit test), packages/ (README files included), schemas/, scripts/,
# .github/, toolchain scripts and root configuration. Fail-safe: no paths at all, or a path Git quotes
# (unusual characters), also prints `true`.
set -euo pipefail

# Reads all input (no early exit), so that a writer into a pipe never gets SIGPIPE.
count=0
needed=false
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  count=$((count + 1))
  # In `case`, `*` also matches `/`.
  case "$path" in
    docs/* | .claude/* | verification/* | toolchain/*.md) ;;
    */*) needed=true ;;
    *.md) ;;
    *) needed=true ;;
  esac
done

if [ "$count" -eq 0 ]; then needed=true; fi
echo "$needed"
