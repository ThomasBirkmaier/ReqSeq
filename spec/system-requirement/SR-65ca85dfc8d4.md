---
id: 6adc6d21-3789-4788-8156-65ca85dfc8d4
type: system-requirement
status: approved
title: "Unbekannte Typen vor dem Import zeigen"
spec-id: "SR-055"
requirement-type: functional
acceptance-criteria:
  - Gegeben eine ReqIF-Datei mit Typen oder Attributen ohne Zuordnung, wenn sie mit `reqseq reqif analyze` gelesen oder der Import gestartet wird, dann listet das Tool sie vor dem Schreiben jeder Datei auf; der Import lehnt dann mit `reqif.unmapped` und derselben Liste ab.
  - "Gegeben diese Liste, wenn für jeden Eintrag in der Zuordnung ein Typ oder eine Property, bei einer Auswahl-Property auch ihre Werte, gewählt oder Weglassen (`omit: true`) eingetragen wird, über `reqseq reqif save-mapping` oder in der YAML-Datei, dann läuft der erneut gestartete Import durch. Die Werte einer Auswahl-Property listet das Tool erst, wenn die Property gewählt ist; dafür kann eine zweite Runde nötig sein."
  - Gegeben der Import lehnt ab (fehlende Zuordnung, ungültige Datei oder Konflikt ohne Wahl nach SR-056), wenn die Dateien geprüft werden, dann ist keine Datei geändert.
verification-method: test
topic: "Import und Export"
packages:
  - { id: 7755a224-01c9-4710-869a-7b1477fbd624, version: n1:cd51c9fc3d83c915, title: "Stufe 6: Austausch per ReqIF und Schutz" }
derives-from:
  - { id: 6adc531a-5a09-476b-9253-7a620b9698d3, version: n1:212741657b151bd3, title: Unbekannte Typen beim Import }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n1:ed13abb3520fa053, title: Kein Austausch von Metamodellen }
---

Wenn eine Import-Datei Typen oder Attribute ohne Zuordnung enthält, muss das Tool sie vor dem Import zeigen und eine Zuordnung verlangen.
