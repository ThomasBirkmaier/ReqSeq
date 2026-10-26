---
id: 6adc6c93-699d-4e53-a117-72ad9d26b2cf
type: system-requirement
status: draft
title: "Unterschied einer Variante zum Kern zeigen"
spec-id: "SR-044"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Variante, wenn ihr Unterschied zum Kern abgefragt wird, dann listet das Tool getrennt die ergänzten, ersetzten und ausgeschlossenen Requirements."
  - "Gegeben ein ersetztes Requirement, wenn es in der Liste ausgewählt wird, dann zeigt das Tool Kern-Requirement und Ersatz nebeneinander."
verification-method: test
topic: "Varianten"
packages:
  - { id: c44d8f37-ca09-4e36-8bcb-772f426a3e1a, version: n1:54e1ce86e105e590, title: "Stufe 5: Pakete, Baselines und Varianten" }
derives-from:
  - { id: 6ad3a422-7a13-458e-87c5-cf0c3829c511, version: n1:4e36884ccd4580cf, title: Unterschied zum Kern erkennbar }
based-on:
  - { id: 6adc615d-b1c4-489a-8843-ecc4593d0bf6, version: n1:25b099d02473c3e0, title: Unterschiede zeigt die Versionsverwaltung }
---

Das Tool muss für jede Variante zeigen, welche Requirements sie gegenüber dem Kern ergänzt, ersetzt oder ausschließt.
