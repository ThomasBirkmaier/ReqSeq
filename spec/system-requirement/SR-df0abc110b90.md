---
id: 583888a0-ca2b-4883-b1bd-df0abc110b90
type: system-requirement
status: approved
title: Gleichzeitige Schreibaufrufe in einem Prozess
spec-id: SR-166
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-02: Gleichzeitige Schreibaufrufe im selben Prozess (API, MCP-Server) müssen verlustfrei sein (#685)."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein Prozess der API, des MCP-Servers oder der App erhält mehrere Schreibaufrufe gleichzeitig, auch auf dasselbe Element, wenn alle beendet sind, dann melden alle Aufrufe Erfolg, die nacheinander Erfolg gemeldet hätten, und die Dateien halten das Ergebnis, das diese Aufrufe nacheinander ausgeführt ergeben hätten.
  - Gegeben mehrere gleichzeitige Schreibaufrufe in einem Prozess, wenn ein Aufruf nacheinander ausgeführt abgelehnt worden wäre, zum Beispiel weil er einen älteren Stand der Datei erwartet, dann meldet er einen Fehler und ändert keine Datei.
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:3431ccb8330c70d3, title: Ablage und Repositories }
verification-method: test
derives-from:
  - { id: 6adc676b-fe66-4306-a6f2-3689d63c8400, version: n2:20d807fdfaa9cb3b, title: Mehrere Agenten parallel }
---

Das Tool muss gleichzeitige Schreibaufrufe auf dieselbe lokale Kopie innerhalb eines Prozesses so ausführen, als liefen sie nacheinander, sodass keine Änderung eines Aufrufs verloren geht, der Erfolg meldet.
