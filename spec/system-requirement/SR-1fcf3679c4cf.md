---
id: 6adc6d96-2f86-4aa8-9f72-1fcf3679c4cf
type: system-requirement
status: approved
title: "Getrennte Kopien parallel bearbeiten"
spec-id: "SR-081"
requirement-type: functional
acceptance-criteria:
  - key: mxry
    text: Gegeben fünf Agenten arbeiten auf fünf getrennten lokalen Kopien desselben Repositories auf einem Rechner, wenn sie gleichzeitig Kommandozeile oder MCP-Server nutzen, dann enthält jede Kopie danach genau die Änderungen ihres Agenten, und kein Aufruf schlägt wegen eines anderen fehl.
  - key: kscy
    text: Gegeben das Tool, wenn es Zwischenspeicher anlegt, dann liegt der jeder Kopie in einem eigenen Ordner außerhalb der Kopien.
  - key: j4rm
    text: Gegeben zwei Kopien legen je 100 Elemente an und werden mit Git zusammengeführt, wenn geprüft wird, dann gibt es keine doppelten IDs und keine Befunde aus Zwischenspeichern.
verification-method: test
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:39b8c7c89788abe8, title: Ablage und Repositories }
derives-from:
  - { id: 6adc676b-fe66-4306-a6f2-3689d63c8400, version: n2:20d807fdfaa9cb3b, title: Mehrere Agenten parallel }
based-on:
  - { id: 6ad39064-0c17-44eb-b1b3-069ebda57ac6, version: n1:9c540adec22e0e1f, title: Jeder arbeitet auf einer lokalen Kopie }
  - { id: 6adc4eb0-23e6-4e81-9ae8-e964fba47a8d, version: n2:882381883f0fb18e, title: Zusammenarbeit liegt außerhalb des Tools }
---

Das Tool muss mehrere Instanzen auf getrennten lokalen Kopien gleichzeitig laufen lassen, ohne dass sie sich gegenseitig beeinflussen.
