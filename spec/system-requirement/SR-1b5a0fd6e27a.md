---
id: 6adc6d90-2b1b-4060-86c6-1b5a0fd6e27a
type: system-requirement
status: approved
title: Nach Property, Nachweisstatus, Datum oder Hierarchie sortieren
spec-id: "SR-075"
requirement-type: functional
acceptance-criteria:
  - key: dmt0
    text: "Gegeben eine Liste von Elementen, wenn nach dem Typ, nach dem Status oder nach einer Property sortiert wird, die keine Beziehungen hält, dann ordnet das Tool die Liste auf- oder absteigend nach ihrem Wert, bei mehreren Werten nach dem ersten: Typ, Status und feste Werte in der Reihenfolge des Metamodells, die Ziffernfolgen einer Kennung als Zahlen (SR-9 vor SR-10), sonst Zahlen vor Text und Text ohne Rücksicht auf Groß- und Kleinschreibung; Elemente ohne Wert stehen am Ende, nur absteigend nach der Kennung am Anfang, und Elemente mit gleichem Wert stehen bei jedem Aufruf in derselben Reihenfolge."
  - key: f889
    text: Gegeben eine Liste, wenn die Hierarchie gewählt wird, dann zeigt das Tool die Elemente als Baum nach ihren Ableitungen. Jedes Element erscheint einmal, unter einem Parent der Liste mit der kürzesten Tiefe; ein Parent außerhalb der Liste zählt nicht, und Kreise werden wie in der Kette abgeschnitten.
  - key: rffk
    text: Gegeben eine Sortierung, wenn Elemente angelegt werden, dann speichert das Tool keine feste Reihenfolge in den Dateien.
  - key: c3cc
    text: Gegeben eine Auswahl von Elementen, wenn sie nach dem Nachweisstatus sortiert wird (`element.list`), dann stehen sie aufsteigend in der Folge nicht bestanden, offen, veraltet, nachgewiesen, absteigend umgekehrt, im Nachweisstatus der Sicht der Eingabe, ohne Angabe im Kern; indirekt nachgewiesen (SR-034) zählt als nachgewiesen; Elemente ohne Nachweisstatus, also Elemente, die kein Requirement sind, und Requirements außerhalb der Sicht (SR-137 AK4), stehen in beiden Richtungen am Ende; bei gleichem Wert gilt AK1.
  - key: qr2j
    text: "Gegeben eine Auswahl von Elementen, wenn sie nach dem Zeitpunkt der Fassung sortiert wird (`element.list`, D-013), dann stehen sie aufsteigend die älteste zuerst, absteigend die neueste zuerst; ein Element, dessen Inhalt vom letzten Commit abweicht oder dessen Datei noch in keinem Commit steht, zählt als neuer als jedes committete; ein Element ohne Zeitpunkt aus einem anderen Grund (etwa ohne Git, flacher Klon) steht in beiden Richtungen am Ende; bei gleichem Wert gilt AK1. Antwortet Git nicht rechtzeitig, stehen die Elemente ohne ermittelten Zeitpunkt am Ende, und die Ausgabe sagt, dass die Reihenfolge nicht vollständig ermittelt ist. Rechtzeitig heißt hier je Aufruf von Git: innerhalb von 10 s für `git rev-parse`, innerhalb von 60 s für jedes `git log` und jede Runde von `git cat-file`; eine gemeinsame Frist für alle Aufrufe einer Sortierung gibt es nicht."
verification-method: test
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:b9b03ddc1ea7cb2d, title: Finden und Listen }
derives-from:
  - { id: 6adc50a5-05d9-4e59-adfc-ae0179b6e5bf, version: n1:7b0a5a4bd2ba1739, title: Filtern }
based-on:
  - { id: 6adc615b-8a00-4ce4-9526-56bd3b72bfc9, version: n2:7c87e88362a6b473, title: Keine feste Reihenfolge }
rationale: "Kennung absteigend (AK1): Absteigend nach der Kennung kehrt sich die ganze Ordnung um, Elemente ohne Kennung stehen dann am Anfang, wie gebaut. Frist je Aufruf (AK5, #2347): Die Frist gilt für jeden Aufruf von Git einzeln, nicht für die ganze Sortierung; eine Runde von `git cat-file` ist eine Anfrage nach einer Gruppe von Objekten an den laufenden Prozess, bis Git sie beantwortet hat. Die Antwortzeit der ersten Seite regelt SR-082 AK4."
---

Das Tool muss Listen nach Properties, nach dem [Nachweisstatus](reqseq:03ce02e1-30af-4525-a0cc-81211316b1bc?version=n2:481b6d233203bf66), nach dem Zeitpunkt der [Fassung](reqseq:6ad4f981-630d-4227-9025-e1a5fad9ad7c?version=n2:180b056a64f9072f) oder nach der Hierarchie der Ableitungen ordnen, ohne eine feste Reihenfolge zu speichern.
