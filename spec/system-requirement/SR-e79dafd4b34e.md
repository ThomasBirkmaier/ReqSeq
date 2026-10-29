---
id: 6adc7b00-c11d-4c7d-b4b9-e79dafd4b34e
type: system-requirement
status: approved
title: "Zyklen in Ableitungen melden"
spec-id: "SR-090"
requirement-type: functional
acceptance-criteria:
  - "Gegeben A leitet sich aus B ab, B aus C und C aus A, wenn geprüft wird, dann meldet das Tool einen Zyklus mit A, B und C."
  - "Gegeben ein Zyklus, wenn über die Kommandozeile geprüft wird, dann endet die Prüfung mit Exit-Code 1."
verification-method: test
topic: "Traceability und Ketten"
packages:
  - { id: 76455508-8047-4fdc-ba94-495751bd880b, version: n1:fc6046c245ac6717, title: "Stufe 2: Traceability" }
derives-from:
  - { id: 6ad3a132-19a2-4a9c-83c7-2470c9c71be1, version: n1:ab23c3ad252d23f2, title: Vollständige Kette vom Parent bis zum Child }
  - { id: 6adc6938-28fa-42f6-b018-5bbf010cc58c, version: n1:36dc84f63608e84c, title: Bestand prüfen }
based-on:
  - { id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc, version: n1:24d0db5bd6fe4be0, title: Fest eingebaute Bedeutungen des Metamodells }
---

Wenn Beziehungen mit der Bedeutung Ableitung einen Zyklus bilden, muss das Tool den Zyklus mit allen beteiligten Elementen melden.
