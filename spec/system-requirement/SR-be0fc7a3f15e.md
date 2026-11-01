---
id: c4978584-9ee8-46f1-83f8-be0fc7a3f15e
type: system-requirement
status: approved
title: Metamodell als Graph und als Text zeigen
spec-id: SR-130
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-27: Es muss einen Befehl geben, der das Schema des Arbeitsbereichs zeigt, grafisch und schriftlich, die grafische Darstellung zuerst; er folgt nach dem Graphen des aktuellen Elements (SR-111). Der Graph des Metamodells zeigt Typen, nicht Elemente; die Regel aus D-063, nie den ganzen Bestand zu zeigen, betrifft den Graph der Elemente. Entscheidung des Produktverantwortlichen, 2026-11-01: Der Text nennt je Property, ob sie zur Fassung zählt (D-057), denn sonst bleibt unsichtbar, welche Änderungen Nachweise veralten lassen. Anlass ist ein Befund aus dem ersten Pilotlauf (#624)."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein geöffneter Arbeitsbereich, wenn in der Befehlszeile der Befehl zum Anzeigen des Metamodells gewählt wird, dann öffnet sich ein Buffer mit dem Metamodell als Graph.
  - Gegeben der Graph des Metamodells, wenn er angezeigt wird, dann ist jeder Typ ein Knoten mit Anzeigename, Präfix und seinen Properties einschließlich der geerbten, jede Vererbung eine Kante vom Typ zum Eltern-Typ und jede Beziehungsart und jede Property mit Beziehungen eine beschriftete Kante zwischen den Typen, die sie als Quelle und Ziel erlaubt.
  - Gegeben eine Beziehungsart ohne Einschränkung der Quell- oder Zieltypen, wenn der Graph angezeigt wird, dann erscheint sie einmal je Typ der eingeschränkten Seite mit dem Hinweis, für welche Seite alle Typen erlaubt sind.
  - Gegeben der Graph des Metamodells, wenn er mit der Tastatur bedient wird, dann lässt sich zwischen den Knoten wechseln und zwischen Graph und Text umschalten.
  - Gegeben das Metamodell als Text, wenn es angezeigt wird, dann nennt es zu jedem Typ Schlüssel, Anzeigename, Präfix, Eltern-Typ, Properties mit Wertart, Pflicht und der Angabe, ob sie zur Fassung zählen, und Statuswerte und zu jeder Beziehungsart die erlaubten Quell- und Zieltypen.
  - Gegeben dasselbe Metamodell, wenn es über App, Kommandozeile, API und MCP-Server abgefragt wird, dann liefern alle dieselben Typen, Vererbungen, Properties, Statuswerte und Beziehungsarten.
verification-method: test
topic: Metamodell und Typen
derives-from:
  - { id: 0a18e65d-e41b-4ed7-8662-8bc7e547d5ab, version: n1:48629460c434fb03, title: Metamodell des Projekts sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:fdb39689e8cfdeb5, title: Oberfläche als weißes Blatt }
packages:
  - { id: cf800f25-d03d-4092-8783-334263089f89, version: n1:06520a1e692d8288, title: "Stufe 3: Oberfläche" }
---

Das Tool muss das Metamodell des geöffneten Arbeitsbereichs auf Befehl als Graph und als Text zeigen.
