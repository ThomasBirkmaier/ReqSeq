---
id: 6adc6bae-acdb-43e4-8540-bc31d4ebca76
type: system-requirement
status: approved
title: "Bestand schnell prüfen"
spec-id: "SR-020"
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-24: Zielwert bestätigt. Die Prüfung läuft in jedem Merge Request und soll ihn nicht spürbar verzögern."
requirement-type: performance
acceptance-criteria:
  - "Gegeben ein Arbeitsbereich mit 50.000 Elementen und 200.000 Beziehungen auf einem Rechner mit 4 Kernen und 16 GB Speicher, wenn die Prüfung über die Kommandozeile läuft, dann ist sie nach höchstens 60 Sekunden fertig."
verification-method: test
topic: "Metamodell und Typen"
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n1:7315eea66e551d94, title: "Stufe 1: Fundament" }
derives-from:
  - { id: 6ad4f636-daf5-4ccf-86d9-ddb4a7ec1b28, version: n1:dfb6208ba57988f0, title: Große Datenmengen }
  - { id: 6adc6938-28fa-42f6-b018-5bbf010cc58c, version: n1:36dc84f63608e84c, title: Bestand prüfen }
based-on:
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n1:ddba1713410acb43, title: Kommandozeile neben der App }
---

Die Kommandozeile muss einen Arbeitsbereich mit 50.000 Elementen in höchstens 60 Sekunden prüfen.
