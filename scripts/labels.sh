#!/usr/bin/env bash
# Creates or updates the labels used by the agent workflow. Usage: scripts/labels.sh owner/repo
set -euo pipefail
repo="$1"
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null; echo "label $1"; }
label sr            0f6b74 "Implements one system requirement"
label enabler       5a6670 "Work without its own system requirement"
label bug           d73a4a "Something does not work as specified"
for n in 0 1 2 3 4 5 6; do label "stage:$n" c5def5 "Stage $n (D-035, D-052)"; done
label spec-frage    fbca04 "Question about the spec for the product owner"
label spec-geändert e99695 "Spec changed after implementation"
label spec-export   bfd4f2 "Export of the spec from Logseq"
label blocked       b60205 "Waiting on another issue or an answer"
label agent:working 1d76db "An agent is working on this"
label needs-human   6b3fa0 "Only Thomas merges this"
for t in ablage-und-repositories metamodell-und-typen traceability-und-ketten bearbeiten-und-finden \
         nachweis-und-abdeckung varianten pakete-und-baselines import-und-export \
         anbindung-und-auswertung betrieb-und-leistung; do
  label "thema:$t" ededed "Thema $t"
done
