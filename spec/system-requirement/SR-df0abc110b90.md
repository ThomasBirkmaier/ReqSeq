---
id: 583888a0-ca2b-4883-b1bd-df0abc110b90
type: system-requirement
status: draft
title: Gleichzeitige Schreibaufrufe in einem Prozess
spec-id: SR-166
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-02: Gleichzeitige Schreibaufrufe im selben Prozess (API, MCP-Server) müssen verlustfrei sein (#685)."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein Prozess der API, des MCP-Servers oder der App erhält mehrere Schreibaufrufe gleichzeitig, auch auf dasselbe Element, wenn alle beendet sind, dann melden alle Aufrufe Erfolg, die nacheinander Erfolg gemeldet hätten, und die Dateien halten das Ergebnis, das diese Aufrufe nacheinander ausgeführt ergeben hätten.
  - Gegeben mehrere gleichzeitige Schreibaufrufe in einem Prozess, wenn ein Aufruf nacheinander ausgeführt abgelehnt worden wäre, zum Beispiel weil er einen älteren Stand der Datei erwartet, dann meldet er einen Fehler und ändert keine Datei.
packages:
  - { id: 7a12a8c7-43e7-4349-9453-0ac2b6d5157d, version: n1:a36637ced6997ca7, title: Querschnitt }
verification-method: test
topic: Betrieb und Leistung
derives-from:
  - { id: 6adc676b-fe66-4306-a6f2-3689d63c8400, version: n1:3600eec6a5b21089, title: Mehrere Agenten parallel }
---

Das Tool muss gleichzeitige Schreibaufrufe auf dieselbe lokale Kopie innerhalb eines Prozesses so ausführen, als liefen sie nacheinander, sodass keine Änderung eines Aufrufs verloren geht, der Erfolg meldet.
