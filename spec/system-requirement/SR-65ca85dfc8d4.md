---
id: 6adc6d21-3789-4788-8156-65ca85dfc8d4
type: system-requirement
status: approved
title: "Unbekannte Typen vor dem Import zeigen"
spec-id: "SR-055"
requirement-type: functional
acceptance-criteria:
  - key: st6d
    text: Gegeben eine ReqIF-Datei mit Typen oder Attributen ohne Zuordnung, wenn sie mit `reqseq reqif analyze` gelesen oder der Import gestartet wird, dann listet das Tool sie auf, bevor es eine Datei schreibt; der Import lehnt dann mit `reqif.unmapped` und derselben Liste ab.
  - key: mp8w
    text: "Gegeben diese Liste, wenn für jeden Eintrag in der Zuordnung ein Typ oder eine Property, bei einer Property mit festen Werten auch ihre Werte, gewählt oder Weglassen (`omit: true`) eingetragen wird, über `reqseq reqif save-mapping` oder in der YAML-Datei, dann läuft der erneut gestartete Import durch."
  - key: ttn9
    text: Gegeben der Import lehnt ab (fehlende Zuordnung, ungültige Datei oder Konflikt ohne Wahl nach SR-056, fehlendes Repository oder Element-Datei, die sich nicht lesen lässt, nach SR-053 AK3), wenn die Dateien geprüft werden, dann ist keine Datei geändert.
verification-method: test
packages:
  - { id: 0d3dc867-b3e5-401f-a6db-d95463166616, version: n2:0a96ee534d188a3a, title: Austausch per ReqIF }
derives-from:
  - { id: 6adc531a-5a09-476b-9253-7a620b9698d3, version: n1:212741657b151bd3, title: Unbekannte Typen beim Import }
based-on:
  - { id: 6adc5318-7e31-4925-b180-ff19c4c61c5f, version: n2:05581a0e4c20cadf, title: Kein Austausch von Metamodellen }
---

Wenn eine Import-Datei Typen oder Attribute ohne Zuordnung enthält, muss das Tool sie vor dem Import zeigen und eine Zuordnung verlangen.
