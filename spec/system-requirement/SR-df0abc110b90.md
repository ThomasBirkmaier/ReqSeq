---
id: 583888a0-ca2b-4883-b1bd-df0abc110b90
type: system-requirement
status: approved
title: Gleichzeitige Schreibaufrufe auf dieselbe lokale Kopie
spec-id: SR-166
rationale: Gleichzeitige Schreibaufrufe im selben Prozess (API, MCP-Server) müssen verlustfrei sein (#685).
requirement-type: functional
acceptance-criteria:
  - key: p44g
    text: Gegeben ein Prozess der API, des MCP-Servers oder der App erhält mehrere Schreibaufrufe gleichzeitig, auch auf dasselbe Element, wenn alle beendet sind, dann melden alle Aufrufe Erfolg, die nacheinander Erfolg gemeldet hätten, und die Dateien halten das Ergebnis, das diese Aufrufe nacheinander ausgeführt ergeben hätten.
  - key: t7wn
    text: Gegeben mehrere gleichzeitige Schreibaufrufe in einem Prozess, wenn ein Aufruf nacheinander ausgeführt abgelehnt worden wäre, zum Beispiel weil er einen älteren Inhalt der Datei erwartet (`element.update` mit dem Prüfwert der Datei aus `element.get`), dann meldet er einen Fehler und ändert keine Datei.
  - key: cwf8
    text: Gegeben ein anderer Prozess hat eine Datei geändert, seit ein Schreibbefehl sie gelesen hat, wenn der Schreibbefehl sie schreiben will, dann schreibt er sie nicht und meldet einen Fehler.
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:39b8c7c89788abe8, title: Ablage und Repositories }
verification-method: test
derives-from:
  - { id: 6adc676b-fe66-4306-a6f2-3689d63c8400, version: n2:20d807fdfaa9cb3b, title: Mehrere Agenten parallel }
based-on:
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:3795ac071493804f, title: API und MCP-Server neben der App }
---

Das Tool muss gleichzeitige Schreibaufrufe auf dieselbe lokale Kopie innerhalb eines Prozesses so ausführen, als liefen sie nacheinander, sodass keine Änderung eines Aufrufs verloren geht, der Erfolg meldet. Hat ein anderer Prozess eine Datei geändert, seit ein Schreibbefehl sie gelesen hat, schreibt das Tool sie nicht.
