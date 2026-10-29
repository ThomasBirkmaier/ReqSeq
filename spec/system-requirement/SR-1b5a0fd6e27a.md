---
id: 6adc6d90-2b1b-4060-86c6-1b5a0fd6e27a
type: system-requirement
status: approved
title: "Nach Property oder Hierarchie sortieren"
spec-id: "SR-075"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Liste von Elementen, wenn nach einer Property sortiert wird, dann ordnet das Tool die Liste auf- oder absteigend danach."
  - Gegeben eine Liste, wenn die Hierarchie gewählt wird, dann zeigt das Tool die Elemente als Baum nach ihren Ableitungen. Jedes Element erscheint einmal, unter einem Parent der Liste mit der kürzesten Tiefe; ein Parent außerhalb der Liste zählt nicht, und Kreise werden wie in der Kette abgeschnitten.
  - "Gegeben eine Sortierung, wenn Elemente angelegt werden, dann speichert das Tool keine feste Reihenfolge in den Dateien."
verification-method: test
topic: "Bearbeiten und Finden"
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:06520a1e692d8288, title: "Stufe 3: Oberfläche" }
derives-from:
  - { id: 6adc50a5-05d9-4e59-adfc-ae0179b6e5bf, version: n1:7b0a5a4bd2ba1739, title: Filtern }
based-on:
  - { id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9, version: n1:f2e6b92128858d5d, title: Keine feste Reihenfolge }
---

Das Tool muss Listen nach Properties oder nach der Hierarchie der Ableitungen ordnen, ohne eine feste Reihenfolge zu speichern.
