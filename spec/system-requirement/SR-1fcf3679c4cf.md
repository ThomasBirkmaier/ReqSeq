---
id: 6adc6d96-2f86-4aa8-9f72-1fcf3679c4cf
type: system-requirement
status: approved
title: "Getrennte Kopien parallel bearbeiten"
spec-id: "SR-081"
requirement-type: functional
acceptance-criteria:
  - "Gegeben fünf Agenten arbeiten auf fünf getrennten lokalen Kopien desselben Repositories auf einem Rechner, wenn sie gleichzeitig Kommandozeile oder MCP-Server nutzen, dann stören sie sich nicht."
  - "Gegeben das Tool, wenn es Zwischenspeicher anlegt, dann liegen sie getrennt je Kopie."
  - "Gegeben zwei Kopien legen je 100 Elemente an und werden mit Git zusammengeführt, wenn geprüft wird, dann gibt es keine doppelten IDs und keine Befunde aus Zwischenspeichern."
verification-method: test
topic: "Betrieb und Leistung"
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n2:fe4e82907ae44795, title: "Stufe 1: Fundament" }
derives-from:
  - { id: 6adc676b-fe66-4306-a6f2-3689d63c8400, version: n2:20d807fdfaa9cb3b, title: Mehrere Agenten parallel }
based-on:
  - { id: 6ad39064-0c17-44eb-b1b3-069ebda57ac6, version: n1:9c540adec22e0e1f, title: Jeder arbeitet auf einer lokalen Kopie }
  - { id: 6adc4eb0-23e6-4e81-9ae8-e964fba47a8d, version: n2:882381883f0fb18e, title: Zusammenarbeit liegt außerhalb des Tools }
issue: https://github.com/ThomasBirkmaier/ReqSeq/issues/88
---

Das Tool muss mehrere Instanzen auf getrennten lokalen Kopien gleichzeitig laufen lassen, ohne dass sie sich gegenseitig beeinflussen.
