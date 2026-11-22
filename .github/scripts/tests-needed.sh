#!/usr/bin/env bash
# Reads changed paths (one per line, as `git diff --name-only --no-renames` prints them) and prints `true`
# when the heavy checks must run (build, unit tests, spec:check and e2e in `checks`, and `perf`), `false` when every path is one that no test, build or check reads except the static
# checks and trace-check, which run on every pull request (ThomasBirkmaier/ReqSeq-archive#520, ThomasBirkmaier/ReqSeq-archive#566). CI runs the base branch's copy of this
# script, so a pull request cannot classify itself with a changed copy.
#
# Safe paths, checked against the tests and scripts:
# - docs/**          ADRs and architecture: read by people and agents only; not docs/guide/ (the user
#                     documentation, built by `checks`, ADR-0017), and not the generated pictures of
#                     docs/architecture/ with the README that embeds them (packages/docs/src/diagrams.test.ts).
# - .claude/**       agent rules and skills.
# - verification/**  records: read by trace-check only.
# - spec/evidence/** enriched JUnit files of evidence.yml, which runs `workspace check` on them before its pull
#                     request (#946).
# - toolchain/**/*.md, except anything below toolchain/junit/ (read by the e2e test
#   packages/cli/test/e2e/toolchain-junit.test.ts: the guide and the element files of the example workspace,
#   SR-063), and *.md at the root (README.md, CLAUDE.md).
# Everything else needs the tests: spec/ (spec:check), fixtures/
# (fixtures/README.md is read by a testkit test), packages/ (README files included), schemas/, scripts/,
# .github/, toolchain scripts and root configuration. Fail-safe: no paths at all, or a path Git quotes
# (unusual characters), also prints `true`.
#
# With the argument `shell`, it prints `true` when the steps of the desktop shell must run (ADR-0021, Lean CI):
# for changes to the shell itself, to what it starts or shows (the web UI, the UI server in api and cli), to the
# release assembly, to its packaging files and to the workflows. Fail-safe as above.
set -euo pipefail

mode="${1:-tests}"

# Reads all input (no early exit), so that a writer into a pipe never gets SIGPIPE.
count=0
needed=false
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  count=$((count + 1))
  if [ "$mode" = shell ]; then
    case "$path" in
      packages/shell/* | packages/web/* | packages/api/* | packages/cli/* | scripts/package/* | \
        scripts/licenses/crates.mjs | toolchain/packaging/* | .github/* | \"*) needed=true ;;
    esac
    continue
  fi
  # In `case`, `*` also matches `/`.
  case "$path" in
    # First: `case` takes the first arm that matches, and the next arm would take toolchain/junit/*.md.
    toolchain/junit/*) needed=true ;;
    # The user documentation's pages: the docs steps of `checks` build them (ADR-0017).
    docs/guide/*) needed=true ;;
    # The architecture pictures: the drift test compares them with their sources.
    docs/architecture/*.svg | docs/architecture/README.md) needed=true ;;
    docs/* | .claude/* | verification/* | toolchain/*.md) ;;
    # The evidence of the own spec, written by evidence.yml, which checks it with `workspace check` itself (#946).
    spec/evidence/*) ;;
    */*) needed=true ;;
    *.md) ;;
    *) needed=true ;;
  esac
done

if [ "$count" -eq 0 ]; then needed=true; fi
echo "$needed"
