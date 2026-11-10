---
id: 3d5793a1-a4d5-493c-892b-c1b1dded5eca
type: decision
status: accepted
title: Nachweisstatus je Akzeptanzkriterium
spec-id: D-072
based-on:
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n2:7ad54b00f062ca52, title: Ein offenes Format für Nachweis-Datensätze }
---

Ein Requirement gilt erst als nachgewiesen, wenn für jedes seiner Akzeptanzkriterien der neueste Datensatz zur aktuellen Fassung bestanden ist. Fehlt für ein Akzeptanzkriterium ein solcher Datensatz, ist das Requirement nicht nachgewiesen; ob es offen, veraltet oder nicht bestanden ist, legt [SR-031](reqseq:6adc6c43-5d42-4c01-8c55-f332cc90a529?version=n2:9120e6a0d717ed16) fest (Entscheidung des Produktverantwortlichen, 2026-11-10: der Vorrang folgt dem gebauten Verhalten), und das Tool zeigt, wie viele seiner Akzeptanzkriterien schon nachgewiesen sind.

Ein Datensatz kann ein oder mehrere Akzeptanzkriterien über ihre Nummern nennen, gezählt ab 1 in der Reihenfolge des Requirements. Welche Property eines Requirements die Akzeptanzkriterien enthält, legt das Metamodell über eine fest eingebaute Bedeutung fest. Ein Datensatz ohne Nummer gilt für alle Akzeptanzkriterien, etwa ein Prüfprotokoll über das ganze Requirement. Bei automatischen Tests nennt der Testname die Nummer, und die Kommandozeile übernimmt sie beim Ergänzen.

Nachweise altern nicht mit der Zeit. Ein Datensatz gilt, bis sich die Fassung des Requirements ändert.

Grund: Ein Requirement darf nicht als nachgewiesen erscheinen, solange eines seiner Akzeptanzkriterien nie geprüft wurde.
