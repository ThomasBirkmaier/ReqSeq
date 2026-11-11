---
id: 6adc6d8c-633d-449f-9015-82fb7ba816df
type: system-requirement
status: approved
title: "Mehrere Elemente gemeinsam ändern"
spec-id: "SR-071"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Auswahl von Elementen, wenn eine Property für alle gesetzt, ergänzt oder entfernt wird, dann ändert das Tool jede Datei der Auswahl, die die Property zulässt, und darin nur diese Property, dazu höchstens die gespeicherten Titel umbenannter Ziele im selben Repository (D-042)."
  - "Gegeben die Änderung, wenn sie ohne Bestätigung aufgerufen wird (App: in der Befehlszeile; CLI, API, MCP: `element.bulkUpdate`), dann nennt das Tool die Zahl der Elemente, die es ändern würde, und schreibt nichts; erst der Aufruf mit Bestätigung schreibt. Nennt die Bestätigung die Vorschau und hat sich seit der Vorschau geändert, welche Elemente oder welchen Inhalt die Änderung schreiben würde, oder lässt sich eine der Dateien nicht schreiben, lehnt das Tool die Bestätigung ab und schreibt keine Datei."
  - "Gegeben ein Element der Auswahl lässt die Property nach dem Metamodell nicht zu oder hat einen Typ, den das Metamodell nicht kennt, wenn geändert wird, dann lässt das Tool es aus und nennt es."
  - "Gegeben eine Mehrfachänderung soll ID, Typ oder Status setzen, ergänzen oder entfernen (App, CLI, API, MCP: `element.bulkUpdate`), dann lehnt das Tool das ab und schreibt nichts; den Status mehrerer Elemente setzt `element.setStatus` in einem Schritt."
verification-method: test
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:f14e7f16f403237e, title: Element bearbeiten }
derives-from:
  - { id: 6adc693a-e1d7-42a9-aeca-7ab5bfacefec, version: n1:b86cbcab02241a36, title: Mehrere Elemente auf einmal ändern }
based-on:
  - { id: 6adc615b-272a-4377-82e5-9ae991d75bb2, version: n2:5086a4bc7d6ff7de, title: Statuswerte kommen aus dem Metamodell }
---

Das Tool muss eine Property für eine Auswahl von Elementen in einem Schritt setzen, ergänzen oder entfernen lassen. Ergänzen fügt einer Property mit mehreren Werten die genannten Werte hinzu. Entfernen ohne Wert entfernt die Property, mit Werten nur diese Werte.
