---
id: 1d177393-9693-45b9-bba4-9dd0ec74b8f0
type: system-requirement
status: approved
title: Beim ReqIF-Export nur eine ReqIF-Datei ersetzen
spec-id: SR-207
rationale: "Die Angriffsflächen ohne Requirement aus der Liste zu #1429 werden als Draft aufgenommen, mit den empfohlenen Antworten auf die offenen Fragen. Der Export gilt über alle Zugänge, wie die Regel für Dateien der Daten je Stand (SR-062). Die offenen Punkte nach dem Review werden wie empfohlen geklärt: was eine ReqIF-Datei ist, welches Lesen gilt und dass die Regel auch für den Ordner der Bilder gilt."
requirement-type: functional
acceptance-criteria:
  - Gegeben am Zielort liegt eine Datei, die keine ReqIF-Datei ist, zum Beispiel ein JUnit-Ergebnis, wenn über Kommandozeile, API, MCP-Server oder App dorthin exportiert wird, dann lehnt das Tool ab, nennt den Grund und ändert die Datei nicht.
  - Gegeben am Zielort liegt eine ReqIF-Datei, die unverändert ist, seit der Export sie vor dem Schreiben gelesen hat, wenn dorthin exportiert wird, dann ersetzt das Tool sie.
  - Gegeben im Ordner für die Bilder neben der Zieldatei liegt eine Datei, die kein Bild ist, wenn exportiert wird, dann lehnt das Tool ab und ändert sie nicht.
packages:
  - { id: 0d3dc867-b3e5-401f-a6db-d95463166616, version: n2:4a83a04662882161, title: Austausch per ReqIF }
verification-method: test
refines:
  - { id: 6adc6d1e-80be-4ec1-acac-006873bc163c, version: n2:8bbf773ad7730440, title: Paket als ReqIF exportieren }
derives-from:
  - { id: 6adc503f-c806-42c1-9750-179bcea5d1cd, version: n2:527652e809efa5b8, title: Austausch per ReqIF }
  - { id: aeee3f81-d8c1-41b5-8f9a-0a1094845828, version: n2:039cc12cd910e3d5, title: Fremde Inhalte gefahrlos öffnen }
based-on:
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
---

Das Tool darf beim ReqIF-Export eine vorhandene Datei am Zielort nur ersetzen, wenn sie eine ReqIF-Datei ist, also eine XML-Datei mit dem Wurzelelement `REQ-IF`.
