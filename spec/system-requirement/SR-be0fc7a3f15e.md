---
id: c4978584-9ee8-46f1-83f8-be0fc7a3f15e
type: system-requirement
status: approved
title: Metamodell als Graph und als Text zeigen
spec-id: SR-130
rationale: Es muss einen Befehl geben, der das Schema des Arbeitsbereichs zeigt, grafisch und schriftlich, die grafische Darstellung zuerst; er folgt nach dem Graphen des aktuellen Elements (SR-111). Der Graph des Metamodells zeigt Typen, nicht Elemente; die Regel aus D-063, nie den ganzen Bestand zu zeigen, betrifft den Graph der Elemente. Der Text nennt je Property, ob sie zur Fassung zählt (D-057), denn sonst bleibt unsichtbar, welche Änderungen Nachweise veralten lassen. Anlass ist ein Befund aus dem ersten Pilotlauf (#624).
requirement-type: functional
acceptance-criteria:
  - key: dp8b
    text: Gegeben ein geöffneter Arbeitsbereich, wenn in der Befehlszeile der Befehl „Show metamodel“ gewählt wird, dann öffnet sich ein Buffer mit dem Metamodell als Graph.
  - key: s795
    text: Gegeben der Graph des Metamodells, wenn er angezeigt wird, dann ist jeder Typ ein Knoten mit Anzeigename, Präfix, seinen Properties einschließlich der geerbten und seinen Statuswerten einschließlich der geerbten, Anfangsstatus und ungültige Statuswerte gekennzeichnet, jede Vererbung eine Kante vom Typ zum Eltern-Typ und jede Beziehungsart und jede Property mit Beziehungen eine beschriftete Kante zwischen den Typen, die sie als Quelle und Ziel erlaubt.
  - key: j585
    text: Gegeben eine Beziehungsart ohne Einschränkung der Quell- oder Zieltypen, wenn der Graph angezeigt wird, dann führt ihre Kante auf der offenen Seite zu einem Knoten „Any type“, den es nur dann gibt, einmal je Typ der eingeschränkten Seite und mit der offenen Seite in der Beschriftung; sind beide Seiten offen, ist sie eine Schleife an diesem Knoten mit der Beschriftung, dass Quelle und Ziel beliebig sind.
  - key: g9gk
    text: Gegeben der Graph des Metamodells, wenn er mit der Tastatur bedient wird, dann lässt sich zwischen den Knoten wechseln und zwischen Graph und Text umschalten.
  - key: y6rs
    text: Gegeben das Metamodell als Text, wenn es angezeigt wird, dann nennt es zu jedem Typ Schlüssel, Anzeigename, Präfix, Eltern-Typ, ob er abstrakt ist, Properties mit Wertart, mehreren Werten mit Höchstzahl, Pflicht, erlaubten Ziel-Typen und der Angabe, ob sie zur Fassung zählen, und Statuswerte und zu jeder Beziehungsart die erlaubten Quell- und Zieltypen und ihre Mindest- und Höchstzahlen.
  - key: cmt2
    text: Gegeben dasselbe Metamodell, wenn es über App, Kommandozeile, API und MCP-Server abgefragt wird, dann liefern alle dieselben Typen, Vererbungen, Properties, Statuswerte und Beziehungsarten.
  - key: wb12
    text: "Gegeben ein Befehl zum Ändern des Metamodells (SR-236) hat in der App eine Datei des Metamodells geschrieben, wenn danach der Graph oder der Text des Metamodells angezeigt wird, dann ist jede Stelle markiert, die eine geänderte oder neue Definition selbst zeigt: bei einem Typ im Graphen Anzeigename, Präfix und das Kennzeichen abstrakt seines Knotens und die Beschriftung „extends“ seiner Kante zum Eltern-Typ, im Text die Zeile mit Anzeigename, Präfix, Schlüssel und dem Kennzeichen abstrakt und die Zeile „extends“; bei einer Property ihre Property-Zeile in jedem Typ, im Graphen und im Text, und ihre Beschriftung an ihren Kanten; bei einem Statuswert sein Eintrag in jedem Typ, im Graphen und im Text; bei einer Beziehungsart ihre Beschriftung an ihren Kanten, im Text die Zeile mit ihrem Namen und die Zeilen ihrer Mindest- und Höchstzahlen. Als geändert oder neu gilt nur die Definition, die der Befehl nennt: der Typ bei „Add type“ und „Change type definition“, die Property bei „Add property to type“ und „Change property definition“, der Statuswert bei „Add status to type“ und „Change status definition“, dort auch der Statuswert, der das Kennzeichen Anfangsstatus verliert, und die Beziehungsart bei „Add relation kind“ und „Change relation kind“. Eine Property oder ein Statuswert, der einem Typ gegeben wurde, ist nur in diesem Typ und in den Typen markiert, die von ihm erben, eine Property mit Beziehungen nur an den Kanten von diesen Typen, ein Statuswert auch in den anderen Typen, die ihn dadurch haben (SR-240 AK1). Keine andere Stelle ist markiert, auch keine, an der eine andere Definition die geänderte nennt, etwa „extends“ bei einem erbenden Typ, ein Typ als Quell- oder Ziel-Typ oder in einer Mindest- oder Höchstzahl einer Beziehungsart oder als Ziel-Typ einer Property. Die Markierung bleibt bis zum nächsten solchen Befehl, bis ein Arbeitsbereich geöffnet wird oder bis die App endet; nach „Remove type“, „Remove property from type“, „Remove status from type“ oder „Remove relation kind“ ist nichts markiert, und Änderungen über andere Zugänge oder von Hand markieren nichts."
verification-method: test
derives-from:
  - { id: 0a18e65d-e41b-4ed7-8662-8bc7e547d5ab, version: n1:48629460c434fb03, title: Metamodell des Projekts sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:91dfc3774f2974a7, title: Oberfläche als weißes Blatt }
  - { id: 6adc78d0-70c6-4553-afd0-f972137d5459, version: n2:71036bdc85f8ac90, title: Kennzeichen für die Fassung }
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:9a6d5b6b85dc5026, title: Metamodell und Prüfung }
---

Das Tool muss das Metamodell des geöffneten Arbeitsbereichs auf Befehl als Graph und als Text zeigen.
