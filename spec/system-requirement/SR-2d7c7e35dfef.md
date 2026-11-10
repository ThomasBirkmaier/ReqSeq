---
id: 22c19f87-f69e-40f2-a762-2d7c7e35dfef
type: system-requirement
status: approved
title: Kontextmenü einer Liste
spec-id: SR-198
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-08: Wer nur die Maus gewohnt ist, soll per Rechtsklick ein klassisches Kontextmenü bekommen, im Editor und in der ganzen App, als eigenes Menü im Stil der App mit einer kurzen, festen Auswahl von Befehlen je Stelle (D-075)."
requirement-type: functional
acceptance-criteria:
  - Gegeben eine Liste, wenn außerhalb ihrer Zeilen, zum Beispiel auf ihrer Überschrift, mit der rechten Maustaste geklickt wird, dann enthält das Kontextmenü „Filter list by type“, „Filter list by status“, „Filter list by text search“, „Sort list“ und „Group list“, bei gruppierter Liste statt „Group list“ „Ungroup list“, und bei gefilterter Liste zusätzlich „Clear all list filters“.
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:05f7041d485c484a, title: Finden und Listen }
verification-method: test
derives-from:
  - { id: f7e0d304-30ac-43c8-9683-1c432a0f119a, version: n2:2d5ec8cb0a706279, title: Mit der Maus bedienen }
based-on:
  - { id: 08ee8add-ef27-4972-ab4c-e0b8bcad916e, version: n2:dd7c650242a62a72, title: Kontextmenü per Rechtsklick }
refines:
  - { id: 1faf2c14-c73c-45d7-862a-e9f1a217e6c9, version: n2:61f45c3734ab497b, title: Befehle per Rechtsklick am Ort aufrufen }
---

Die App muss in einer Liste außerhalb ihrer Zeilen per Rechtsklick ein Kontextmenü mit den Befehlen zum Filtern, Sortieren und Gruppieren der Liste öffnen.
