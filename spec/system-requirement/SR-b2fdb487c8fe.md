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
topic: "Ablage und Repositories"
packages:
  - { id: 46610a27-2866-47fb-bb8f-293faae4885f, version: n1:7315eea66e551d94, title: "Stufe 1: Fundament" }
derives-from:
  - { id: 6ad4f636-3b68-4ace-a3be-12ebdcba9b2a, version: n1:fb6a0af7414140ba, title: Ein oder viele Repositories }
based-on:
  - { id: 6adc5317-4e70-4297-942b-10bf39e10d85, version: n1:180d45183746b285, title: Das Metamodell gehört zum Stand }
  - { id: 6adc6921-ddaf-4756-954c-0072d0fc0739, version: n1:c4e82ee52111436d, title: Arbeitsbereich als Datei }
---

Das Tool muss die Repositories eines Arbeitsbereichs aus der Arbeitsbereichs-Datei im Haupt-Repository lesen und alle lokal vorhandenen gemeinsam öffnen.
