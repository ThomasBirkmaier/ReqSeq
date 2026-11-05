---
id: 6adc7af9-5aa9-408a-8b40-b26efaff1525
type: system-requirement
status: approved
title: "Property-Werte nach Wertart prüfen"
spec-id: "SR-085"
requirement-type: functional
acceptance-criteria:
  - Gegeben eine Property mit Wertart Text, Zahl, Datum, Auswahl oder Beziehung, wenn in der Datei ein Wert der falschen Art steht, dann zeigt das Tool einen Hinweis.
  - Gegeben eine Auswahl-Property mit den Werten low, medium und high, wenn in der Datei ein anderer Wert steht, dann zeigt das Tool einen Hinweis mit den erlaubten Werten.
  - Gegeben ein solcher Wert, wenn der Bestand über die Kommandozeile geprüft wird, dann erscheint er als Befund.
  - Gegeben eine Property mit Wertart Zahl, wenn über einen Schreibbefehl ein Text als Wert eingetragen wird, dann weist das Tool den Wert zurück und schreibt nichts.
verification-method: test
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:cbcfa73eec53e04c, title: Metamodell und Prüfung }
derives-from:
  - { id: 6ad47d8b-773c-4d21-bf35-1b7deeb96561, version: n1:de3fc7e167c1c882, title: Anpassbares Metamodell }
  - { id: 6adc6938-28fa-42f6-b018-5bbf010cc58c, version: n1:36dc84f63608e84c, title: Bestand prüfen }
based-on:
  - { id: 6adc6922-7314-49bd-bfed-ff5f8a7211b4, version: n1:2afec40a822b7839, title: Feste Schlüssel im Metamodell }
---

Wenn ein Property-Wert nicht der Wertart aus dem Metamodell entspricht, muss das Tool einen Hinweis zeigen.
