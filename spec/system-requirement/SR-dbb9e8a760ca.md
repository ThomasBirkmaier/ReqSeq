---
id: 6adc6d20-e825-45be-8813-dbb9e8a760ca
type: system-requirement
status: draft
title: "Zuordnung zum Metamodell als Datei speichern"
spec-id: "SR-054"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein erster Import, wenn Typen und Attribute der Quelle den Typen und Properties des Metamodells zugeordnet werden, dann speichert das Tool die Zuordnung als YAML-Datei im Repository."
  - "Gegeben eine gespeicherte Zuordnung, wenn dieselbe Quelle erneut importiert oder dorthin exportiert wird, dann verwendet das Tool sie ohne Nachfrage."
  - "Gegeben eine Zuordnung, wenn das Metamodell der Quelle gelesen wird, dann ändert das Tool das eigene Metamodell nicht."
verification-method: test
topic: "Import und Export"
packages:
  - { id: 7755a224-01c9-4710-869a-7b1477fbd624, version: n1:7380b854b6603b06, title: "Stufe 6: Austausch per ReqIF und Schutz" }
derives-from:
  - { id: 6adc5040-2819-4ec5-a9e9-ad790fd35904, version: n1:526f731b8e4f202f, title: Zuordnung zum Metamodell }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n1:f0c47ea417438735, title: Kein Austausch von Metamodellen }
  - { id: 6adc78cf-bdda-461d-9245-ee53800698fb, version: n1:4a9fb120c7818346, title: Aufbau der Dateien mit fester Länge des Dateinamens }
---

Das Tool muss die Zuordnung der Typen und Attribute einer Quelle zum eigenen Metamodell als Datei speichern und wiederverwenden.
