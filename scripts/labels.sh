#!/usr/bin/env bash
# Creates or updates the issue labels (CLAUDE.md, Issues). Each label's meaning is its description, which GitHub shows
# when filtering. Labels no longer used are kept with an "Obsolete" description, because they stay on closed issues.
# Usage: scripts/labels.sh owner/repo
set -euo pipefail
repo="$1"
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null; echo "label $1"; }

# Type: exactly one per issue.
label bug           d73a4a "Type: something does not work as specified or as expected"
label feature       0e8a16 "Type: a new or changed function a user notices"
label task          5a6670 "Type: maintenance, refactoring, CI, rules or docs"
label question      fbca04 "Type: a question for the product owner, about the spec or a decision"
# Area: exactly one per issue, where the main change is.
label core          1d76db "Area: packages/core"
label cli           1d76db "Area: packages/cli"
label api           1d76db "Area: packages/api"
label mcp           1d76db "Area: packages/mcp"
label app           1d76db "Area: packages/app"
label spec          1d76db "Area: spec/, the specification"
label dev           1d76db "Area: CI, scripts, agent rules, skills and docs"
# Priority: exactly one per issue.
for p in 1 2 3; do label "P$p" e4a11b "Priority $p (1 must, 2 should, 3 could)"; done
# Waiting and structure.
label needs-human   6b3fa0 "Waits until the product owner answers, decides or checks"
label epic          3e4b9e "A task too large for one PR, cut into sub-issues"
label agent:working c5def5 "An agent is working on this"
# Set by workflows, never by hand: main-red (main-check.yml), perf (perf.yml), dependencies and github_actions (Dependabot).
label main-red      b60205 "Set by main-check: main fails typecheck or lint"
label perf          d4c5f9 "PR: runs the perf suite once; issue: a threshold exceeded (perf.yml, ADR-0011)"

# GitHub limits a description to 100 characters.
obsolete() { label "$1" ededed "Obsolete since 2026-11-07: $2"; }
for l in sr enabler spec-frage pilot dogfooding security blocked review spec-geändert agent-ergonomie querschnitt \
         spec-export sr-issues stage:0 stage:1 stage:2 stage:3 stage:4 stage:5 stage:6 stage:later; do
  obsolete "$l" "see CLAUDE.md, Issues"
done
for t in ablage-und-repositories metamodell-und-typen traceability-und-ketten bearbeiten-und-finden \
         nachweis-und-abdeckung varianten pakete-und-baselines import-und-export \
         anbindung-und-auswertung betrieb-und-leistung; do
  obsolete "thema:$t" "the topic is the spec package of the SR"
done
for l in accessibility documentation duplicate enhancement "good first issue" "help wanted" invalid wontfix; do
  obsolete "$l" "GitHub default, not used (CLAUDE.md, Issues)"
done
