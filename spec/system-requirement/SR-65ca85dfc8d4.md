---
id: 6adc6d21-3789-4788-8156-65ca85dfc8d4
type: system-requirement
status: draft
title: "Unbekannte Typen vor dem Import zeigen"
spec-id: "SR-055"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine ReqIF-Datei mit Typen oder Attributen ohne Zuordnung, wenn der Import gestartet wird, dann listet das Tool sie vor dem Schreiben jeder Datei auf."
  - "Gegeben diese Liste, wenn für jeden Eintrag eine Zuordnung gewählt oder Weglassen gewählt wird, dann setzt das Tool den Import fort."
  - "Gegeben der Import wird abgebrochen, wenn die Dateien geprüft werden, dann ist keine Datei geändert."
verification-method: test
topic: "Import und Export"
packages:
  - { id: 7755a224-01c9-4710-869a-7b1477fbd624, version: n1:7380b854b6603b06, title: "Stufe 6: Austausch per ReqIF und Schutz" }
derives-from:
  - { id: 6adc531a-5a09-476b-9253-7a620b9698d3, version: n1:8609deac5f9089d5, title: Unbekannte Typen beim Import }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n1:f0c47ea417438735, title: Kein Austausch von Metamodellen }
---

Wenn eine Import-Datei Typen oder Attribute ohne Zuordnung enthält, muss das Tool sie vor dem Import zeigen und eine Zuordnung verlangen.
