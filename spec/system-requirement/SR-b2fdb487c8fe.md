---
id: 6adc6ac6-de13-4a53-9e75-b2fdb487c8fe
type: system-requirement
status: approved
title: "Arbeitsbereich aus Datei laden"
spec-id: "SR-004"
requirement-type: functional
acceptance-criteria:
  - "Gegeben eine Arbeitsbereichs-Datei nennt drei Repositories, die alle lokal vorhanden sind, wenn der Arbeitsbereich geöffnet wird, dann zeigt das Tool die Elemente aller drei Repositories gemeinsam."
  - "Gegeben ein Arbeitsbereich mit nur einem Repository, wenn er geöffnet wird, dann stehen alle Funktionen genauso zur Verfügung wie bei mehreren Repositories."
  - "Gegeben ein genanntes Repository fehlt lokal, wenn der Arbeitsbereich geöffnet wird, dann zeigt das Tool es als nicht vorhanden und arbeitet mit den übrigen normal."
verification-method: test
packages:
  - { id: 3aaac15c-a3ae-44d6-a640-c0fa48ccd25e, version: n2:3431ccb8330c70d3, title: Ablage und Repositories }
derives-from:
  - { id: 6ad4f636-3b68-4ace-a3be-12ebdcba9b2a, version: n1:fb6a0af7414140ba, title: Ein oder viele Repositories }
based-on:
  - { id: 6adc5317-4e70-4297-942b-10bf39e10d85, version: n2:5fa2f004bf0408a2, title: Das Metamodell gehört zum Stand }
  - { id: 6adc6921-ddaf-4756-954c-0072d0fc0739, version: n2:ab35a04348d6fa8b, title: Arbeitsbereich als Datei }
---

Das Tool muss die Repositories eines Arbeitsbereichs aus der Arbeitsbereichs-Datei im Haupt-Repository lesen und alle lokal vorhandenen gemeinsam öffnen.
