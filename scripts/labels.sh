#!/usr/bin/env bash
# Creates or updates the labels used by the agent workflow. Usage: scripts/labels.sh owner/repo
set -euo pipefail
repo="$1"
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null; echo "label $1"; }
label sr            0f6b74 "Implements one system requirement"
label enabler       5a6670 "Work without its own system requirement"
label bug           d73a4a "Something does not work as specified"
for n in 0 1 2 3 4 5 6; do label "stage:$n" c5def5 "Stage $n (D-035, D-052)"; done
label stage:later   c5def5 "Not planned for a stage (package Später)"
label spec-frage    fbca04 "Question about the spec for the product owner"
label spec-geändert e99695 "Spec changed after implementation"
label spec-export   bfd4f2 "Export of the spec from Logseq (obsolete since #326)"
label dogfooding    c5def5 "Found while using ReqSeq on its own spec"
label blocked       b60205 "Waiting on another issue or an answer"
label agent:working 1d76db "An agent is working on this"
label querschnitt   0e8a16 "Cross-cutting SR, stays open across stages"
label needs-human   6b3fa0 "The product owner must answer something"
label perf          d4c5f9 "Run the performance suite (PR) or a threshold exceeded (issue), ADR-0011"
for t in ablage-und-repositories metamodell-und-typen traceability-und-ketten bearbeiten-und-finden \
         nachweis-und-abdeckung varianten pakete-und-baselines import-und-export \
         anbindung-und-auswertung betrieb-und-leistung; do
  label "thema:$t" ededed "Thema $t"
done
