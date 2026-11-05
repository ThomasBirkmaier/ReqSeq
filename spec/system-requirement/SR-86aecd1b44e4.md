---
id: 6adc6c4a-6284-4d56-93b7-86aecd1b44e4
type: system-requirement
status: approved
title: "Validierungsstatus zeigen"
spec-id: "SR-038"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Need mit einem Datensatz der Art Validierung zur aktuellen Fassung, wenn er angezeigt wird, dann zeigt das Tool den Validierungsstatus getrennt vom Nachweisstatus."
  - "Gegeben eine Validierung zu einer älteren Fassung, wenn der Status berechnet wird, dann ist er veraltet."
  - Gegeben die Validierungs-Datensätze eines Elements, wenn der Validierungsstatus berechnet wird, dann ist er offen ohne Datensatz, erfolgreich, nicht erfolgreich oder nicht beurteilbar (SR-172) nach dem neuesten Datensatz zur aktuellen Fassung und veraltet, wenn es nur Datensätze zu älteren Fassungen gibt.
  - Gegeben ein Datensatz der Art Validierung mit Angabe einer Variante, wenn er gelesen oder erfasst wird, dann weist das Tool ihn ab, nennt den Grund und er zählt für keinen Status.
verification-method: test
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:1261455098bd8d6a, title: Nachweis und Abdeckung }
derives-from:
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n1:b20a6c9601d52cfe, title: Status von Nachweis und Validierung }
based-on:
  - { id: 6ad49d01-5018-4d89-9350-37989131ccc1, version: n2:53ccd5c22e173820, title: Nachweise und Validierungen als Datensätze }
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n2:f99d3d6f08b13a10, title: Ein offenes Format für Nachweis-Datensätze }
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-04: AK3 an SR-172 angeglichen, das den Validierungsstatus nicht beurteilbar einführt."
---

Das Tool muss für jeden Need und jedes Element mit Validierungs-Datensätzen einen eigenen Validierungsstatus berechnen und zeigen.
