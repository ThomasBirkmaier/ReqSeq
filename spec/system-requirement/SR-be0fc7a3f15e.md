---
id: c4978584-9ee8-46f1-83f8-be0fc7a3f15e
type: system-requirement
status: approved
title: Metamodell als Graph und als Text liefern
spec-id: SR-130
rationale: Es muss einen Befehl geben, der das Schema des Arbeitsbereichs zeigt, grafisch und schriftlich, die grafische Darstellung zuerst; er folgt nach dem Graphen des aktuellen Elements (SR-111). Der Graph des Metamodells zeigt Typen, nicht Elemente; die Regel aus D-063, nie den ganzen Bestand zu zeigen, betrifft den Graph der Elemente. Der Text nennt je Property, ob sie zur Fassung zählt (D-057), denn sonst bleibt unsichtbar, welche Änderungen Nachweise veralten lassen. Anlass ist ein Befund aus dem ersten Pilotlauf (#624).
requirement-type: functional
acceptance-criteria:
  - key: s795
    text: "Gegeben das Metamodell, wenn sein Graph als Mermaid ausgegeben wird (CLI, API, MCP: `metamodel.mermaid`), dann ist jeder Typ ein Knoten mit Anzeigename, Präfix und seinen Properties einschließlich der geerbten, jede Vererbung eine Kante vom Typ zum Eltern-Typ und jede Beziehungsart und jede Property mit Beziehungen eine beschriftete Kante zwischen den Typen, die sie als Quelle und Ziel erlaubt."
  - key: j585
    text: Gegeben eine Beziehungsart ohne Einschränkung der Quell- oder Zieltypen, wenn der Graph als Mermaid ausgegeben wird, dann führt ihre Kante auf der offenen Seite zu einem Knoten „Any type“, den es nur dann gibt, einmal je Typ der eingeschränkten Seite und mit der offenen Seite in der Beschriftung; sind beide Seiten offen, ist sie eine Schleife an diesem Knoten mit der Beschriftung, dass Quelle und Ziel beliebig sind.
  - key: y6rs
    text: "Gegeben das Metamodell, wenn es als Text abgefragt wird (CLI, API, MCP: `metamodel.get`), dann nennt die Ausgabe zu jedem Typ Schlüssel, Anzeigename, Präfix, Eltern-Typ, ob er abstrakt ist, Properties mit Wertart, mehreren Werten mit Höchstzahl, Pflicht, erlaubten Ziel-Typen und der Angabe, ob sie zur Fassung zählen, und Statuswerte mit Anfangsstatus und ungültigen Statuswerten gekennzeichnet und zu jeder Beziehungsart die erlaubten Quell- und Zieltypen und ihre Mindest- und Höchstzahlen."
  - key: cmt2
    text: Gegeben dasselbe Metamodell, wenn es über Kommandozeile, API und MCP-Server abgefragt wird, dann liefern alle dieselben Typen, Vererbungen, Properties, Statuswerte und Beziehungsarten.
verification-method: test
derives-from:
  - { id: 0a18e65d-e41b-4ed7-8662-8bc7e547d5ab, version: n1:48629460c434fb03, title: Metamodell des Projekts sehen }
based-on:
  - { id: 6adc78d0-70c6-4553-afd0-f972137d5459, version: n2:71036bdc85f8ac90, title: Kennzeichen für die Fassung }
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:9a6d5b6b85dc5026, title: Metamodell und Prüfung }
---

Das Tool muss das Metamodell des geöffneten Arbeitsbereichs auf Befehl als Graph in Mermaid und als Text liefern.
