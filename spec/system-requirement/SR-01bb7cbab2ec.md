---
id: 6adc7b04-8e48-40e1-8fdb-01bb7cbab2ec
type: system-requirement
status: approved
title: "Prüfung auf geänderte Elemente beschränken"
spec-id: "SR-092"
requirement-type: functional
acceptance-criteria:
  - "Gegeben ein Merge Request ändert 3 von 1.000 Elementen, wenn mit Angabe des Ziel-Commits geprüft wird, dann meldet das Tool nur Befunde zu diesen 3 Elementen, zu ihren Zielen und zu den Beziehungen und Verweisen anderer Elemente, die auf eines der 3 zeigen."
  - "Gegeben ein Commit, der lokal nicht vorhanden ist, wenn geprüft wird, dann meldet die Kommandozeile das und endet mit Exit-Code 4."
verification-method: test
packages:
  - { id: 546c26ea-a25f-4ccf-a9c7-ce63607961b3, version: n2:4585916724ff3a77, title: Traceability }
derives-from:
  - { id: 6adc6159-6d45-4ace-9173-5eb99508383c, version: n2:1f7ff4ed17406ff7, title: Prüfung auf veraltete Verweise im Merge Request }
based-on:
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n2:d8bcd2a465d55357, title: Kommandozeile neben der App }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
---

Die Kommandozeile muss die Prüfung auf die Elemente beschränken können, die sich gegenüber einem angegebenen Commit geändert haben, samt deren Zielen und der Beziehungen und Verweise, die auf sie zeigen.
