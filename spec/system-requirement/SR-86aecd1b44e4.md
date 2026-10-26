---
id: 6adc6c4a-6284-4d56-93b7-86aecd1b44e4
type: system-requirement
status: draft
title: "Validierungsstatus zeigen"
spec-id: "SR-038"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Need mit einem Datensatz der Art Validierung zur aktuellen Fassung, wenn er angezeigt wird, dann zeigt das Tool den Validierungsstatus getrennt vom Nachweisstatus."
  - "Gegeben eine Validierung zu einer älteren Fassung, wenn der Status berechnet wird, dann ist er veraltet."
  - "Gegeben die Validierungs-Datensätze eines Elements, wenn der Validierungsstatus berechnet wird, dann ist er offen ohne Datensatz, erfolgreich oder nicht erfolgreich nach dem neuesten Datensatz zur aktuellen Fassung und veraltet, wenn es nur Datensätze zu älteren Fassungen gibt."
verification-method: test
topic: "Nachweis und Abdeckung"
packages:
  - { id: 5e69295a-2847-469f-9bd4-a11e20ceba9f, version: n1:89fcc971400d045e, title: "Stufe 4: Nachweise" }
derives-from:
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n1:1f20fb6aee13790a, title: Status von Nachweis und Validierung }
based-on:
  - { id: 6ad49d01-5018-4d89-9350-37989131ccc1, version: n1:c7b2060d1be86a9d, title: Nachweise und Validierungen als Datensätze }
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n1:9355a14c6f926710, title: Ein offenes Format für Nachweis-Datensätze }
---

Das Tool muss für jedes Element mit Validierungs-Datensätzen einen eigenen Validierungsstatus berechnen und zeigen.
