---
id: 6adc6d8c-633d-449f-9015-82fb7ba816df
type: system-requirement
status: draft
title: "Mehrere Elemente gemeinsam ändern"
spec-id: "SR-071"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Auswahl von Elementen, wenn eine Property für alle gesetzt, ergänzt oder entfernt wird, dann ändert das Tool jede betroffene Datei und nur diese Property."
  - "Gegeben die Änderung, bevor sie ausgeführt wird, dann zeigt das Tool die Zahl der betroffenen Elemente und verlangt eine Bestätigung."
  - "Gegeben ein Element der Auswahl lässt die Property nach dem Metamodell nicht zu, wenn geändert wird, dann lässt das Tool es aus und nennt es."
verification-method: test
topic: "Bearbeiten und Finden"
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:3ec49c0d5a7866d3, title: "Stufe 3: Oberfläche" }
derives-from:
  - { id: 6adc693a-e1d7-42a9-aeca-7ab5bfacefec, version: n1:e10d903892aebaeb, title: Mehrere Elemente auf einmal ändern }
based-on:
  - { id: 6adc615b-272a-4377-82e5-9ae991d75bb2, version: n1:ffbb237a2ab2997b, title: Statuswerte kommen aus dem Metamodell }
---

Das Tool muss eine Property für eine Auswahl von Elementen in einem Schritt setzen, ergänzen oder entfernen lassen. Ergänzen fügt einer Property mit mehreren Werten die genannten Werte hinzu. Entfernen ohne Wert entfernt die Property, mit Werten nur diese Werte.
