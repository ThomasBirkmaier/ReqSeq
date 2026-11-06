---
id: 3d5793a1-a4d5-493c-892b-c1b1dded5eca
type: decision
status: accepted
title: Nachweisstatus je Akzeptanzkriterium
spec-id: D-072
based-on:
  - { id: 6adc58f5-a349-4870-af2f-971ec1cee679, version: n2:f99d3d6f08b13a10, title: Ein offenes Format für Nachweis-Datensätze }
---

Ein Requirement gilt erst als nachgewiesen, wenn für jedes seiner Akzeptanzkriterien der neueste Datensatz zur aktuellen Fassung bestanden ist. Fehlt für ein Akzeptanzkriterium ein solcher Datensatz, bleibt das Requirement offen, und das Tool zeigt, wie viele seiner Akzeptanzkriterien schon nachgewiesen sind.

Ein Datensatz kann ein oder mehrere Akzeptanzkriterien über ihre Nummer nennen, gezählt ab 1 in der Reihenfolge des Requirements. Welche Property eines Requirements die Akzeptanzkriterien enthält, legt das Metamodell über eine fest eingebaute Bedeutung fest. Ein Datensatz ohne Nummer gilt für alle Akzeptanzkriterien, etwa ein Prüfprotokoll über das ganze Requirement. Bei automatischen Tests nennt der Testname die Nummer, und die Kommandozeile übernimmt sie beim Ergänzen.

Nachweise altern nicht mit der Zeit. Ein Datensatz gilt, bis sich die Fassung des Requirements ändert.

Grund: Ein Requirement darf nicht als nachgewiesen erscheinen, solange eines seiner Akzeptanzkriterien nie geprüft wurde.
