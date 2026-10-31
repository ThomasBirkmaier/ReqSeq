---
id: 4d50eec6-09b9-4659-a8c8-d22b4f6aac0f
type: system-requirement
status: approved
title: Auswahlwerte per Mausklick setzen
spec-id: SR-156
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-31: Per Tastatur öffnet eine Box mit festen Werten die Werteauswahl in der Befehlszeile, per Maus öffnet sich nichts. Ein Klick soll dieselbe Auswahl öffnen wie die Tastatur, kein eigenes Dropdown an der Box, weil die Befehlszeile nach D-062 die einzige Bedienstelle ist und ein Klick dort als Weg zum Anfordern vorgesehen ist. Eingetragen in Später."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein geöffnetes Element mit einer Property mit festen Werten im Metamodell, wenn ihre Box angeklickt wird, dann öffnet die Befehlszeile dieselbe Werteauswahl wie beim Bearbeiten dieser Box per Tastatur, mit genau den Werten aus dem Metamodell (SR-104).
  - Gegeben die per Klick geöffnete Werteauswahl, wenn ein Wert angeklickt wird, dann setzt das Tool ihn mit demselben Ergebnis wie die Auswahl dieses Werts per Tastatur.
  - Gegeben die per Klick geöffnete Werteauswahl, wenn Escape gedrückt oder außerhalb der Befehlszeile geklickt wird, dann schließt sie und der Wert der Property bleibt unverändert.
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
verification-method: test
topic: Bearbeiten und Finden
refines:
  - { id: 2c4b0595-c212-42b7-81be-b18556f3b2fe, version: n1:ce7d8ec8e019b511, title: Properties als Boxen bearbeiten }
derives-from:
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:ff4acfc7f0085726, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:fdb39689e8cfdeb5, title: Oberfläche als weißes Blatt }
---

Die App muss bei einer Property mit festen Werten die Werteauswahl der Befehlszeile auch per Mausklick öffnen und einen Wert per Klick setzen lassen.
