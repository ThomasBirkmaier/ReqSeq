---
id: 6adc6bae-acdb-43e4-8540-bc31d4ebca76
type: system-requirement
status: approved
title: "Bestand schnell prüfen"
spec-id: "SR-020"
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-24: Zielwert bestätigt. Die Prüfung läuft in jedem Merge Request und soll ihn nicht spürbar verzögern."
requirement-type: performance
acceptance-criteria:
  - "Gegeben ein Arbeitsbereich mit 50.000 Elementen und 200.000 Beziehungen auf einem Rechner mit 4 Kernen und 16 GB Speicher, wenn die Prüfung über die Kommandozeile ohne Zwischenspeicher läuft, dann ist sie nach höchstens 60 Sekunden fertig."
verification-method: test
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:cbcfa73eec53e04c, title: Metamodell und Prüfung }
derives-from:
  - { id: 6ad4f636-daf5-4ccf-86d9-ddb4a7ec1b28, version: n1:dfb6208ba57988f0, title: Große Datenmengen }
  - { id: 6adc6938-28fa-42f6-b018-5bbf010cc58c, version: n1:36dc84f63608e84c, title: Bestand prüfen }
based-on:
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n2:d8bcd2a465d55357, title: Kommandozeile neben der App }
---

Die Kommandozeile muss einen Arbeitsbereich mit 50.000 Elementen in höchstens 60 Sekunden prüfen.
