---
id: 6adc6c41-94dd-4aeb-b394-c3ce3cc86e5b
type: system-requirement
status: draft
title: "Datensatz im Tool erfassen"
spec-id: "SR-030"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Requirement, wenn dafür ein Datensatz erfasst wird, dann sind ID und aktuelle Fassung schon eingetragen."
  - "Gegeben ein erfasster Datensatz mit Art, Methode, Ergebnis, Prüfling, Datum und Verweis auf einen Beleg, wenn er gespeichert wird, dann entsteht eine Datei im offenen Format in der gewählten Ablage."
  - "Gegeben ein Datensatz der Art Validierung, wenn er gespeichert wird, dann zählt er für den Validierungsstatus und nicht für den Nachweisstatus."
verification-method: test
topic: "Nachweis und Abdeckung"
packages:
  - { id: 5e69295a-2847-469f-9bd4-a11e20ceba9f, version: n1:89fcc971400d045e, title: "Stufe 4: Nachweise" }
derives-from:
  - { id: 6ad39e3f-7e60-4366-8cc6-f01bd8691823, version: n1:602da7fff18080dc, title: Abdeckung über Werkzeuggrenzen }
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n1:1f20fb6aee13790a, title: Status von Nachweis und Validierung }
based-on:
  - { id: 6ad49d01-5018-4d89-9350-37989131ccc1, version: n1:c7b2060d1be86a9d, title: Nachweise und Validierungen als Datensätze }
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n1:9355a14c6f926710, title: Ein offenes Format für Nachweis-Datensätze }
---

Das Tool muss Datensätze für manuelle Tests, Inspektionen, Analysen, Demonstrationen und Validierungen erfassen lassen.
