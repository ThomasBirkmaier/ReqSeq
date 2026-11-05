---
id: 6adc6938-28fa-42f6-b018-5bbf010cc58c
type: need
status: approved
title: "Bestand prüfen"
spec-id: "N-065"
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:cbcfa73eec53e04c, title: Metamodell und Prüfung }
---

Im Merge Request muss sich der ganze Bestand automatisch prüfen lassen: fehlende Pflichtfelder, unbekannte Properties, Beziehungen auf fehlende Ziele, Zyklen aus Parent und Child und doppelte IDs. Das Ergebnis muss eine Pipeline auswerten können.
