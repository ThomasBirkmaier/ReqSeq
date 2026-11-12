---
id: c4978584-9ee8-46f1-83f8-be0fc7a3f15e
type: system-requirement
status: approved
title: Metamodell als Graph und als Text zeigen
spec-id: SR-130
rationale: Es muss einen Befehl geben, der das Schema des Arbeitsbereichs zeigt, grafisch und schriftlich, die grafische Darstellung zuerst; er folgt nach dem Graphen des aktuellen Elements (SR-111). Der Graph des Metamodells zeigt Typen, nicht Elemente; die Regel aus D-063, nie den ganzen Bestand zu zeigen, betrifft den Graph der Elemente. Der Text nennt je Property, ob sie zur Fassung zählt (D-057), denn sonst bleibt unsichtbar, welche Änderungen Nachweise veralten lassen. Anlass ist ein Befund aus dem ersten Pilotlauf (#624).
requirement-type: functional
acceptance-criteria:
  - Gegeben ein geöffneter Arbeitsbereich, wenn in der Befehlszeile der Befehl „Show metamodel“ gewählt wird, dann öffnet sich ein Buffer mit dem Metamodell als Graph.
  - Gegeben der Graph des Metamodells, wenn er angezeigt wird, dann ist jeder Typ ein Knoten mit Anzeigename, Präfix und seinen Properties einschließlich der geerbten, jede Vererbung eine Kante vom Typ zum Eltern-Typ und jede Beziehungsart und jede Property mit Beziehungen eine beschriftete Kante zwischen den Typen, die sie als Quelle und Ziel erlaubt.
  - Gegeben eine Beziehungsart ohne Einschränkung der Quell- oder Zieltypen, wenn der Graph angezeigt wird, dann führt ihre Kante auf der offenen Seite zu einem Knoten „Any type“, den es nur dann gibt, einmal je Typ der eingeschränkten Seite und mit der offenen Seite in der Beschriftung; sind beide Seiten offen, ist sie eine Schleife an diesem Knoten mit der Beschriftung, dass Quelle und Ziel beliebig sind.
  - Gegeben der Graph des Metamodells, wenn er mit der Tastatur bedient wird, dann lässt sich zwischen den Knoten wechseln und zwischen Graph und Text umschalten.
  - Gegeben das Metamodell als Text, wenn es angezeigt wird, dann nennt es zu jedem Typ Schlüssel, Anzeigename, Präfix, Eltern-Typ, ob er abstrakt ist, Properties mit Wertart, mehreren Werten mit Höchstzahl, Pflicht, erlaubten Ziel-Typen und der Angabe, ob sie zur Fassung zählen, und Statuswerte und zu jeder Beziehungsart die erlaubten Quell- und Zieltypen und ihre Mindest- und Höchstzahlen.
  - Gegeben dasselbe Metamodell, wenn es über App, Kommandozeile, API und MCP-Server abgefragt wird, dann liefern alle dieselben Typen, Vererbungen, Properties, Statuswerte und Beziehungsarten.
verification-method: test
derives-from:
  - { id: 0a18e65d-e41b-4ed7-8662-8bc7e547d5ab, version: n1:48629460c434fb03, title: Metamodell des Projekts sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:2ec3810c4995e7aa, title: Oberfläche als weißes Blatt }
  - { id: 6adc78d0-70c6-4553-afd0-f972137d5459, version: n2:2f8320e9c98aa726, title: Kennzeichen für die Fassung }
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:9a6d5b6b85dc5026, title: Metamodell und Prüfung }
---

Das Tool muss das Metamodell des geöffneten Arbeitsbereichs auf Befehl als Graph und als Text zeigen.
