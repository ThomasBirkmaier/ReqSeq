---
id: 6adc7af9-5aa9-408a-8b40-b26efaff1525
type: system-requirement
status: approved
title: "Property-Werte nach Wertart prüfen"
spec-id: "SR-085"
requirement-type: functional
acceptance-criteria:
  - Gegeben eine Property mit Wertart Text, Zahl, Datum oder Beziehung oder mit festen Werten, wenn in der Datei ein Wert der falschen Art steht, dann zeigt das Tool einen Hinweis.
  - Gegeben eine Property mit den festen Werten low, medium und high, wenn in der Datei ein anderer Wert steht, dann zeigt das Tool einen Hinweis mit den erlaubten Werten.
  - Gegeben ein solcher Wert, wenn der Bestand über die Kommandozeile geprüft wird, dann erscheint er als Befund.
  - Gegeben eine Property mit Wertart Zahl oder Beziehung oder mit festen Werten, wenn über einen Schreibbefehl (App, CLI, API, MCP) ein Wert eingetragen wird, der nicht passt, zum Beispiel ein Text für eine Zahl, ein Wert, der nicht zu den festen Werten gehört, oder ein Eintrag, der nicht genau ein vorhandenes Element nennt, dann weist das Tool den Wert zurück und schreibt nichts; bei Wertart Text oder Datum speichert es den Wert und zeigt den Hinweis aus AK1, außer einem Kriterienschlüssel, den SR-204 AK5 zurückweist.
verification-method: test
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:cbcfa73eec53e04c, title: Metamodell und Prüfung }
derives-from:
  - { id: 6ad47d8b-773c-4d21-bf35-1b7deeb96561, version: n1:de3fc7e167c1c882, title: Anpassbares Metamodell }
  - { id: 6adc6938-28fa-42f6-b018-5bbf010cc58c, version: n1:36dc84f63608e84c, title: Bestand prüfen }
based-on:
  - { id: 6adc6922-7314-49bd-bfed-ff5f8a7211b4, version: n2:d496a4c7295aafde, title: Feste Schlüssel im Metamodell }
---

Wenn ein Property-Wert nicht der Wertart aus dem Metamodell entspricht, muss das Tool einen Hinweis zeigen.
