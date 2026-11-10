---
id: 6adc6d8c-633d-449f-9015-82fb7ba816df
type: system-requirement
status: approved
title: "Mehrere Elemente gemeinsam ändern"
spec-id: "SR-071"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Auswahl von Elementen, wenn eine Property für alle gesetzt, ergänzt oder entfernt wird, dann ändert das Tool jede betroffene Datei und nur diese Property."
  - "Gegeben die Änderung, bevor sie ausgeführt wird, dann zeigt das Tool die Zahl der betroffenen Elemente und verlangt eine Bestätigung."
  - "Gegeben ein Element der Auswahl lässt die Property nach dem Metamodell nicht zu, wenn geändert wird, dann lässt das Tool es aus und nennt es."
verification-method: test
packages:
  - { id: e8a95bf4-c96c-4c8a-9fa0-7e9bc0dbd5bd, version: n2:f14e7f16f403237e, title: Element bearbeiten }
derives-from:
  - { id: 6adc693a-e1d7-42a9-aeca-7ab5bfacefec, version: n1:b86cbcab02241a36, title: Mehrere Elemente auf einmal ändern }
based-on:
  - { id: 6adc615b-272a-4377-82e5-9ae991d75bb2, version: n2:b07fd599a8a95fa1, title: Statuswerte kommen aus dem Metamodell }
---

Das Tool muss eine Property für eine Auswahl von Elementen in einem Schritt setzen, ergänzen oder entfernen lassen. Ergänzen fügt einer Property mit mehreren Werten die genannten Werte hinzu. Entfernen ohne Wert entfernt die Property, mit Werten nur diese Werte.
