---
id: 6adc7b04-8e48-40e1-8fdb-01bb7cbab2ec
type: system-requirement
status: draft
title: "Prüfung auf geänderte Elemente beschränken"
spec-id: "SR-092"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Merge Request ändert 3 von 1.000 Elementen, wenn mit Angabe des Ziel-Commits geprüft wird, dann meldet das Tool nur Befunde zu diesen 3 Elementen und ihren Zielen."
  - "Gegeben ein Commit, der lokal nicht vorhanden ist, wenn geprüft wird, dann meldet die Kommandozeile das und endet mit einem eigenen Exit-Code."
verification-method: test
topic: "Traceability und Ketten"
packages:
  - { id: 76455508-8047-4fdc-ba94-495751bd880b, version: n1:46878bd22e08cb56, title: "Stufe 2: Traceability" }
derives-from:
  - { id: 6adc6159-6d45-4ace-9173-5eb99508383c, version: n1:25f4736982f9af54, title: Prüfung auf veraltete Verweise im Merge Request }
based-on:
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n1:aa83cee4e109580c, title: Kommandozeile neben der App }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n1:84a3de02b0119461, title: Das Tool liest Git nur }
---

Die Kommandozeile muss die Prüfung auf die Elemente beschränken können, die sich gegenüber einem angegebenen Commit geändert haben, samt deren Zielen.
