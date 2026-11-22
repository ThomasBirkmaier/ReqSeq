---
id: 770474eb-4839-4542-be45-fa0f1eaccec3
type: system-requirement
status: approved
title: Metamodell per Befehl ändern
spec-id: SR-236
requirement-type: functional
acceptance-criteria:
  - key: sx7z
    text: "Gegeben ein Befehl zum Ändern des Metamodells (App, CLI, API, MCP: `metamodel.addType`, `metamodel.changeType`, `metamodel.removeType`, `metamodel.addProperty`, `metamodel.changeProperty`, `metamodel.removeProperty`, `metamodel.addRelationKind`, `metamodel.changeRelationKind`, `metamodel.removeRelationKind`, `metamodel.addStatus`, `metamodel.changeStatus`, `metamodel.removeStatus`), wenn das Metamodell danach einen Fehler nach SR-011 AK3 hätte, dann lehnt das Tool ihn ab, nennt den Fehler und schreibt nichts; hätte es nur Warnungen, schreibt das Tool und nennt sie in der Ausgabe."
  - key: rk7z
    text: Gegeben ein solcher Befehl gibt einem Typ ein Präfix oder einen Namen, den schon ein anderer Typ trägt, oder einer Property, einer Beziehungsart einem Statuswert oder einem festen Wert einen Namen, den schon eine andere Definition derselben Liste oder ein anderer fester Wert derselben Property trägt, wenn er ausgeführt wird, dann lehnt das Tool ihn ab und schreibt nichts.
  - key: k2s3
    text: "Gegeben ein solcher Befehl gelingt, wenn er schreibt, dann ändert das Tool nur die Metamodell-Dateien, in denen die geänderten Definitionen stehen, keine Element-Datei und nichts in Git (D-036), und darin nur die Zeilen der geänderten Angaben: Jede andere Zeile bleibt mit Kommentar und Zeilenende zeichengleich, ein Kommentar am Ende einer geänderten Zeile geht verloren, mit einer entfernten Definition entfallen ihre Zeilen und die Kommentarzeilen unmittelbar über ihr, und eine neue Definition steht am Ende ihrer Liste. Die Ausgabe nennt jede geänderte Datei."
  - key: yf6d
    text: Gegeben ein Metamodell aus mehreren Dateien, wenn eine Definition geändert oder entfernt wird, dann ändert das Tool die Datei, in der sie steht; eine neue kommt in die erste Datei nach Namen, die die Liste `types`, `properties`, `relations` oder `statuses` hat, sonst in die erste Datei, an deren Ende die Liste dann entsteht. Ändert ein Befehl mehrere Dateien und lässt sich eine nicht schreiben, steht in jeder der Inhalt von vorher, und das Tool meldet den Grund.
  - key: cv7t
    text: Gegeben das Repository des Metamodells ist schreibgeschützt (SR-018 AK2), das Metamodell lässt sich nicht lesen (SR-011 AK3, AK4) oder die zu ändernde Definition nutzt einen Anker oder Alias der YAML-Datei, wenn ein solcher Befehl ausgeführt wird, dann lehnt das Tool ab, nennt den Grund, bei einem Anker oder Alias Datei und Zeile, und schreibt nichts. In der App stehen die Befehle bei schreibgeschütztem Repository in Befehlszeile und Kontextmenü und lehnen beim Aufruf so ab; bei fehlerhaftem Metamodell gilt SR-133 AK1.
  - key: n13v
    text: "Gegeben eine neue Definition ohne Schlüssel in der Eingabe, wenn sie angelegt wird (App, CLI, API, MCP), dann bildet das Tool den Schlüssel aus dem Namen: Buchstaben klein, Ziffern unverändert, ä, ö, ü und ß als ae, oe, ue und ss, andere Buchstaben mit diakritischem Zeichen als der Buchstabe ohne dieses Zeichen (é als e, ç als c), jede Folge anderer Zeichen als ein Bindestrich, ohne Bindestrich am Anfang und Ende; beginnt das Ergebnis nicht mit einem Buchstaben, ist es länger als 64 Zeichen oder schon Schlüssel einer Definition derselben Art, wobei Properties und Beziehungsarten zusammen zählen, lehnt das Tool ab und verlangt einen Schlüssel. Die Befehlszeile der App zeigt diesen Schlüssel als Vorbelegung, die sich vor dem Anlegen ändern lässt, und schlägt für das Präfix eines neuen Typs die Anfangsbuchstaben der Wörter des Namens in Großbuchstaben vor, außer das Ergebnis ist kein gültiges Präfix (ein Buchstabe A bis Z, danach Buchstaben A bis Z oder Ziffern) oder ein anderer Typ trägt es. Kein Befehl ändert den Schlüssel einer vorhandenen Definition (D-043)."
  - key: bm7r
    text: "Gegeben eine Definition, wenn sie entfernt werden soll oder eine Angabe geändert werden soll, die nur ohne Nutzung änderbar ist (SR-237 bis SR-240), dann gilt als Nutzung: für einen Typ ein Element dieses Typs; für eine Property ihr Schlüssel in der Datei eines Elements des Typs oder eines erbenden Typs, auch mit leerem Wert, und für eine Änderung ihrer Wertart oder mehrerer Werte ihr Schlüssel in der Datei jedes Elements, gleich welchen Typs; für einen festen Wert ein Element mit diesem Wert; für eine Beziehungsart eine Beziehung dieser Art oder ihr Schlüssel in der Datei eines Elements, auch mit leerer Liste; für einen Statuswert ein Element des Typs oder eines erbenden Typs mit diesem Status. Dabei zählt jedes Element, gleich in welchem Status (D-045). Bei Nutzung lehnt das Tool ab, nennt die Zahl und die ersten 20 Elemente nach Kurz-ID mit Kurz-ID und schreibt nichts. Fehlt ein Repository des Arbeitsbereichs lokal, lehnt es jede solche Änderung ab und nennt das Repository. Lässt sich eine Element-Datei nicht lesen (SR-008 AK1, AK2), lehnt es jede solche Änderung ebenso ab und nennt die Zahl dieser Dateien und die ersten 20 nach Repository und Pfad, jede mit Repository und Pfad; fehlt zugleich ein Repository, nennt es das Repository. Nennen gespeicherte Filter, Perspektiven oder Zuordnungen zum Metamodell den Schlüssel einer entfernten Definition, nennt die Ausgabe diese Dateien und ändert sie nicht."
  - key: wq1x
    text: "Gegeben das Metamodell eines Arbeitsbereichs, wenn es abgefragt wird (App, CLI, API, MCP: `metamodel.get`), dann nennt die Ausgabe je Typ, Beziehungsart und festem Wert die Zahl seiner Nutzungen nach AK7, je Statuswert die Zahl der Elemente, gleich welchen Typs, mit diesem Status und je Property die Zahl der Elemente, gleich welchen Typs, deren Datei den Schlüssel der Property enthält, auch mit leerem Wert; das ist die Nutzung, die nach AK7 eine Änderung ihrer Wertart oder mehrerer Werte sperrt. Die Befehlszeile der App zeigt in den Schritten dieser Befehle eine Angabe, deren Änderung die Nutzung sperrt, als gesperrt mit dieser Zahl, und wählt sie nicht."
  - key: drrw
    text: Gegeben ein solcher Befehl ist gelungen, wenn danach derselbe Prozess einen Befehl ausführt, dann arbeitet er mit dem neuen Metamodell, jeder andere laufende Zugang nach SR-015 AK1; ändert sich dadurch die Fassung von Elementen (SR-015 AK4) oder fehlt Elementen eine neue Pflicht-Property (SR-015 AK3), nennt die Ausgabe die Zahl dieser Elemente.
  - key: jskb
    text: "Gegeben ein anderer Schreibaufruf läuft gleichzeitig, wenn ein solcher Befehl ausgeführt wird, dann gilt SR-166: im selben Prozess wie nacheinander, mit der Nutzung nach dem Stand bei der Ausführung, und eine Datei, die ein anderer Prozess seit dem Lesen geändert hat, schreibt der Befehl nicht und meldet einen Fehler."
  - key: q76q
    text: "Gegeben die Befehlszeile der App fragt einen dieser Befehle, wenn sie erscheint, dann fragt sie nur die Schritte, die die Stelle nicht schon liefert (D-077, SR-199 AK2 und AK5 bis AK7): die Definition, die Angabe, die sich ändern soll, und ihren neuen Wert; mehrere Typen, also Quell- und Ziel-Typen oder die Ziel-Typen einer Property, als Marken wie in SR-215 AK5, mit „Any type“ als eigenem Treffer, der keine Liste schreibt; feste Werte je Wert mit Name und Schlüssel als Marke; Mindest- und Höchstzahl je Ziel-Typ als Zahl oder leer. Eine leere Liste von Typen schreibt kein Befehl."
  - key: rtcn
    text: Gegeben dieselbe Eingabe und dasselbe Metamodell, wenn ein solcher Befehl über App, Kommandozeile, API oder MCP-Server ausgeführt wird, dann schreibt das Tool jede Datei Zeichen für Zeichen gleich und liefert dieselbe Ausgabe.
packages:
  - { id: dfdbf57e-059c-49ed-b9b2-21c51e291b3c, version: n2:9a6d5b6b85dc5026, title: Metamodell und Prüfung }
verification-method: test
derives-from:
  - { id: 6ad47d8b-773c-4d21-bf35-1b7deeb96561, version: n2:dd40e8863b51aaf6, title: Anpassbares Metamodell }
based-on:
  - { id: a98dc54b-cbb6-4723-8fc3-0c17e8f20342, version: n2:a400ed35f11c4313, title: Metamodell über Befehle ändern }
  - { id: 6adc5317-4e70-4297-942b-10bf39e10d85, version: n2:5fa2f004bf0408a2, title: Das Metamodell gehört zum Stand }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:b68c1780920b121b, title: API und MCP-Server neben Kommandozeile und Web-Oberfläche }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
  - { id: 6adc6922-7314-49bd-bfed-ff5f8a7211b4, version: n2:d496a4c7295aafde, title: Feste Schlüssel im Metamodell }
  - { id: 6adc6923-8957-4ae9-8e6c-dc5cd1d097c8, version: n2:04e934b66316908b, title: Ablösen statt löschen }
  - { id: 7a120e78-ad90-4f95-b966-6017460b8538, version: n2:4713bc40e4274c0a, title: "Ein Befehl je Tätigkeit, Werte als Schritte" }
---

Das Tool muss das [Metamodell](reqseq:6ad4f970-8cdb-4504-a076-156f65bcba67?version=n2:0824c5d4ad47f4a6) über Befehle ändern lassen, die nur seine Dateien schreiben, kein fehlerhaftes Metamodell hinterlassen und über App, Kommandozeile, API und MCP-Server dieselbe [Ausgabe](reqseq:840d00df-60ed-4742-9b82-9e712f270449?version=n2:164509d02ae16783) liefern.
