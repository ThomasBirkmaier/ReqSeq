---
id: 6adc6d90-2b1b-4060-86c6-1b5a0fd6e27a
type: system-requirement
status: approved
title: "Nach Property oder Hierarchie sortieren"
spec-id: "SR-075"
requirement-type: functional
acceptance-criteria:
  - key: dmt0
    text: "Gegeben eine Liste von Elementen, wenn nach dem Typ, nach dem Status oder nach einer Property sortiert wird, die keine Beziehungen hält, dann ordnet das Tool die Liste auf- oder absteigend nach ihrem Wert, bei mehreren Werten nach dem ersten: Typ, Status und feste Werte in der Reihenfolge des Metamodells, die Ziffernfolgen einer Kennung als Zahlen (SR-9 vor SR-10), sonst Zahlen vor Text und Text ohne Rücksicht auf Groß- und Kleinschreibung; Elemente ohne Wert stehen am Ende, nur absteigend nach der Kennung am Anfang, und Elemente mit gleichem Wert stehen bei jedem Aufruf in derselben Reihenfolge."
  - key: f889
    text: Gegeben eine Liste, wenn die Hierarchie gewählt wird, dann zeigt das Tool die Elemente als Baum nach ihren Ableitungen. Jedes Element erscheint einmal, unter einem Parent der Liste mit der kürzesten Tiefe; ein Parent außerhalb der Liste zählt nicht, und Kreise werden wie in der Kette abgeschnitten.
  - key: rffk
    text: Gegeben eine Sortierung, wenn Elemente angelegt werden, dann speichert das Tool keine feste Reihenfolge in den Dateien.
  - key: qgzh
    text: Gegeben die Liste der Suchtreffer, wenn sie angezeigt wird, dann bietet das Tool für sie keine Sortierung an, auch nicht nach der Hierarchie; die Treffer stehen nach Relevanz (SR-124 AK4).
verification-method: test
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:4f83c4c27eb34539, title: Finden und Listen }
derives-from:
  - { id: 6adc50a5-05d9-4e59-adfc-ae0179b6e5bf, version: n1:7b0a5a4bd2ba1739, title: Filtern }
based-on:
  - { id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9, version: n2:c968a2dc820271d1, title: Keine feste Reihenfolge }
rationale: "Kennung absteigend (AK1): Absteigend nach der Kennung kehrt sich die ganze Ordnung um, Elemente ohne Kennung stehen dann am Anfang, wie gebaut."
---

Das Tool muss Listen nach Properties oder nach der Hierarchie der Ableitungen ordnen, ohne eine feste Reihenfolge zu speichern.
