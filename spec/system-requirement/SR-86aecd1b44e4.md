---
id: 6adc6c4a-6284-4d56-93b7-86aecd1b44e4
type: system-requirement
status: approved
title: "Validierungsstatus zeigen"
spec-id: "SR-038"
requirement-type: functional
acceptance-criteria:
  - key: w0j6
    text: Gegeben ein Need mit einem Datensatz der Art Validierung zur aktuellen Fassung, wenn er angezeigt wird, dann zeigt das Tool seinen Validierungsstatus; bei einem Requirement getrennt vom Nachweisstatus.
  - key: g54k
    text: Gegeben ein Element, dessen Validierungs-Datensätze alle zu älteren Fassungen gehören, wenn der Status berechnet wird, dann ist er veraltet.
  - key: wb3p
    text: Gegeben die Validierungs-Datensätze eines Elements, wenn der Validierungsstatus berechnet wird, dann ist er offen ohne Datensatz, erfolgreich, nicht erfolgreich oder nicht beurteilbar (SR-172) nach dem neuesten Datensatz zur aktuellen Fassung, bei mehreren gleich neuen nach dem schlechtesten Ergebnis (nicht erfolgreich vor nicht beurteilbar vor erfolgreich), und veraltet, wenn es nur Datensätze zu älteren Fassungen gibt.
  - key: zv5h
    text: Gegeben ein Datensatz der Art Validierung mit Angabe einer Variante, wenn er gelesen oder erfasst wird, dann weist das Tool ihn ab, nennt den Grund und er zählt für keinen Status.
  - key: f98s
    text: Gegeben ein Datensatz der Art Validierung zu einem Element, das weder Need noch Requirement ist, wenn die Datensätze gelesen werden, dann zählt er für keinen Status und das Tool meldet ihn als Befund.
verification-method: test
packages:
  - { id: ed14d465-fd3f-4188-992b-3ff7af8595af, version: n2:42294a7722f821a6, title: Nachweis und Abdeckung }
derives-from:
  - { id: 6ad50227-3476-4a97-8ec4-5d4f0543bb22, version: n2:b080b82a30d57303, title: Status von Nachweis und Validierung }
based-on:
  - { id: 6ad49d01-5018-4d89-9350-37989131ccc1, version: n2:1b2559391ba2c4a7, title: Nachweise und Validierungen als Datensätze }
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n2:7ad54b00f062ca52, title: Ein offenes Format für Nachweis-Datensätze }
rationale: AK3 an SR-172 angeglichen, das den Validierungsstatus nicht beurteilbar einführt. Eine Validierung zeigt nur auf einen Need oder ein Requirement (D-012); ein Validierungs-Datensatz zu einem anderen Element zählt nicht und wird gemeldet (AK5).
---

Das Tool muss für jeden Need und jedes Requirement mit Validierungs-Datensätzen einen eigenen Validierungsstatus berechnen und zeigen.
