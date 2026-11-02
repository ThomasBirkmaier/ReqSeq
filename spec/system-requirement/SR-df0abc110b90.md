---
id: 583888a0-ca2b-4883-b1bd-df0abc110b90
type: system-requirement
status: draft
title: Gleichzeitige Schreibaufrufe in einem Prozess
spec-id: SR-166
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-02: Gleichzeitiges Schreiben im selben Prozess (API, MCP-Server) muss verlustfrei sein, weil ein MCP-Client die Werkzeugaufrufe eines Schritts gleichzeitig schickt und ein Agent sich sonst auf keinen gemeldeten Erfolg verlassen kann (#685)."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein Prozess der API oder des MCP-Servers erhält mehrere Schreibaufrufe auf dasselbe Element gleichzeitig, wenn alle beendet sind, dann steht die Änderung jedes Aufrufs, der Erfolg meldet, in der Datei des Elements.
  - Gegeben mehrere gleichzeitige Schreibaufrufe auf dasselbe Element in einem Prozess, wenn die Änderung eines Aufrufs nicht in die Datei geschrieben werden kann, dann meldet dieser Aufruf einen Fehler und keinen Erfolg.
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n1:7315eea66e551d94, title: "Stufe 1: Fundament" }
verification-method: test
topic: Betrieb und Leistung
derives-from:
  - { id: 6adc676b-fe66-4306-a6f2-3689d63c8400, version: n1:3600eec6a5b21089, title: Mehrere Agenten parallel }
refines:
  - { id: 6adc6d96-2f86-4aa8-9f72-1fcf3679c4cf, version: n1:79b6a7e820c15920, title: Getrennte Kopien parallel bearbeiten }
---

Das Tool muss gleichzeitige Schreibaufrufe auf dieselbe lokale Kopie innerhalb eines Prozesses so ausführen, dass keine Änderung verloren geht, deren Aufruf Erfolg meldet.
