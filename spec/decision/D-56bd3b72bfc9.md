---
id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9
type: decision
status: accepted
title: "Keine feste Reihenfolge"
spec-id: "D-031"
---

Requirements haben keine feste Reihenfolge. Sortiert wird nach ID, Typ, Status, Properties oder nach der Hierarchie aus Parent und Children.

Das Standardmodell hat keinen eigenen Typ für Überschriften oder Einleitungen. Wer sie braucht, legt sie im Metamodell an ([N-024](reqseq:6ad47d8b-773c-4d21-bf35-1b7deeb96561?version=n1:de3fc7e167c1c882)).

Grund: Das ist die einfachste Lösung. Dokumente erzeugen externe Werkzeuge, den [HTML-Export](reqseq:7f240c30-80c6-476d-bc9c-0215a0fef867?version=n2:7e08d73bbf3cc65a) das Tool selbst ([D-080](reqseq:b413f77d-743e-4abe-8b79-bceb24c4b7ca?version=n2:a14b879b0af2da59)).
