---
id: 22c19f87-f69e-40f2-a762-2d7c7e35dfef
type: system-requirement
status: approved
title: Kontextmenü einer Liste
spec-id: SR-198
rationale: "Wer nur die Maus gewohnt ist, soll per Rechtsklick ein klassisches Kontextmenü bekommen, im Editor und in der ganzen App, als eigenes Menü im Stil der App mit einer kurzen, festen Auswahl von Befehlen je Stelle (D-075). Freie Fläche (AK1, #1183): Die freie Fläche neben und unter einer Liste behält das Menü des Buffers; nur die Liste selbst hat das Menü der Liste."
requirement-type: functional
acceptance-criteria:
  - Gegeben die Liste aller Elemente, eine gefilterte Liste, die Liste der Suchtreffer oder die Elemente einer Paketseite (SR-112), wenn in ihrer mittigen Spalte (SR-148) außerhalb der Zeilen der Elemente mit der rechten Maustaste geklickt wird, zum Beispiel auf ihrer Überschrift, einer Gruppenüberschrift (SR-149) oder dem Kopf des Abschnitts am Ende (SR-201), dann enthält das Kontextmenü „Filter list by type“, „Filter list by status“, „Filter list by text search“, „Sort list“ und „Group list“, bei gruppierter Liste statt „Group list“ „Ungroup list“, und bei gefilterter Liste zusätzlich „Clear all list filters“; die Liste der Suchtreffer hat kein „Sort list“ (SR-075 AK4), die Elemente einer Paketseite haben kein „Group list“ (SR-112 AK2). Die freie Fläche neben und unter dieser Spalte und die Übersicht und die Umgebung außerhalb der Zeilen ihrer Elemente haben das Kontextmenü des Buffers (SR-194 AK6).
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:4f83c4c27eb34539, title: Finden und Listen }
verification-method: test
derives-from:
  - { id: f7e0d304-30ac-43c8-9683-1c432a0f119a, version: n2:2d5ec8cb0a706279, title: Mit der Maus bedienen }
based-on:
  - { id: 08ee8add-ef27-4972-ab4c-e0b8bcad916e, version: n2:fa15fb6d42e42413, title: Kontextmenü per Rechtsklick }
refines:
  - { id: 1faf2c14-c73c-45d7-862a-e9f1a217e6c9, version: n2:3147fafc899c2f7b, title: Befehle per Rechtsklick am Ort aufrufen }
---

Die App muss in der Spalte der Liste aller Elemente, einer gefilterten Liste, der Liste der Suchtreffer oder der Elemente einer Paketseite außerhalb der Zeilen der Elemente per Rechtsklick ein Kontextmenü mit den Befehlen zum Filtern, Sortieren und Gruppieren der Liste öffnen.
