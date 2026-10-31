---
id: 6adc6d97-8ac2-4012-a447-9aec69e4e30a
type: system-requirement
status: approved
title: "Große Bestände flüssig bearbeiten"
spec-id: "SR-082"
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-24: Zielwerte bestätigt. Referenzrechner: 4 Kerne, 16 GB Speicher, SSD. Entscheidung des Produktverantwortlichen, 2026-10-31: Die 200 ms gelten nicht für das erste Öffnen nach dem Start; dieses hat eine eigene Grenze von 1 Sekunde."
requirement-type: performance
acceptance-criteria:
  - "Gegeben ein Arbeitsbereich mit 50.000 Elementen und 200.000 Beziehungen und vorhandenem Zwischenspeicher, wenn die App startet, dann ist sie nach höchstens 3 Sekunden bedienbar."
  - "Gegeben derselbe Arbeitsbereich ohne Zwischenspeicher, wenn die App startet, dann ist sie nach höchstens 30 Sekunden bedienbar."
  - Gegeben derselbe Arbeitsbereich, in dem seit dem Start bereits ein Element geöffnet wurde, wenn ein Element geöffnet wird, dann ist es nach höchstens 200 ms sichtbar.
  - Gegeben derselbe Arbeitsbereich, wenn ein Filter angewendet oder eine Kette berechnet wird, dann erscheint das Ergebnis nach höchstens 500 ms.
  - Gegeben derselbe Arbeitsbereich, wenn nach dem Start das erste Element geöffnet wird, dann ist es nach höchstens 1 Sekunde sichtbar.
verification-method: test
topic: "Betrieb und Leistung"
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n1:7315eea66e551d94, title: "Stufe 1: Fundament" }
derives-from:
  - { id: 6ad4f636-daf5-4ccf-86d9-ddb4a7ec1b28, version: n1:dfb6208ba57988f0, title: Große Datenmengen }
---

Das Tool muss Arbeitsbereiche mit 50.000 Elementen ohne spürbare Wartezeit bearbeiten lassen.
