---
id: f163b2f7-43b0-4066-a981-14efafdbe409
type: system-requirement
status: approved
title: Perspektiven und gespeicherte Filter in der App aus einer Liste speichern und neu aufbauen
spec-id: SR-219
rationale: Auf einer Liste soll gespeichert werden, was sie zeigt; neu aufgebaut wird ohne Liste, zum Beispiel über mehrere Typen. Enter auf dem übernehmenden Treffer schloss den Befehl nach der Bedingung ab, Gruppierung und Sortierung waren nur über Ctrl+Enter zu erreichen, und „Save perspective“ stand bei der Suche vor „Save list as perspective“; so entstanden Perspektiven ohne die gewählten Bedingungen, Gruppierung und Sortierung. Deshalb heißen die Befehle nach dem, woher ihr Inhalt kommt, und der Aufbau fragt alle Schritte. Über Kommandozeile, API und MCP-Server bleiben `perspective save` und `filter save` (D-029); dieselbe Eingabe schreibt dieselbe Datei (SR-215 AK10). Ein gespeicherter Filter nennt keinen anderen und hat keine Gruppierung (AK8). Ohne Sortierschlüssel speichert eine neue Perspektive die Standardsortierung wie „Save list as perspective“ (SR-214 AK5), damit alle Zugänge dieselbe Reihenfolge liefern (SR-213 AK4); ein gespeicherter Filter speichert eine Sortierung nur, wenn sie gewählt ist, weil sie sonst die Sortierung einer Perspektive ersetzen würde, die ihn nennt (SR-213 AK5). Dieselben Listen wie bei „Save list as perspective“ sind ausgenommen, damit beide Befehle auf denselben Listen stehen.
requirement-type: functional
acceptance-criteria:
  - key: v80n
    text: Gegeben die Befehlszeile, wenn sie Befehle zeigt oder sucht, dann heißen die Befehle, die eine Perspektive bzw. einen gespeicherten Filter ohne Liste neu aufbauen, „New perspective“ und „New saved filter“; sie führen `perspective.save` bzw. `filter.save` aus, und „Save perspective“ und „Save filter“ stehen nicht als eigene Einträge darin. Zur Ansicht passen die beiden in der Übersicht und in einer Liste von Elementen (SR-133 AK1).
  - key: tbwz
    text: "Gegeben „New perspective“ wird gewählt, wenn die Befehlszeile weitergeht, dann fragt sie nacheinander Name, Bedingung, Gruppierung und Sortierung, Gruppierung und Sortierung ohne Ctrl+Enter (unter macOS Cmd+Enter), und bei leerer Eingabe ist der erste Treffer markiert. Die Bedingung beginnt ohne Marke und ohne Treffer für die gezeigte Liste; ihr übernehmender Treffer heißt „Next: grouping“, ohne Marke führt „No condition: all elements“ weiter. Die Gruppierung bietet zuerst „No grouping“ an, dann die Gruppierungen (SR-215 AK1); jede Wahl führt weiter. Die Sortierung bietet zuerst „Save“ an, der mit den gewählten Sortierschlüsseln speichert, ohne Sortierschlüssel mit der Sortierung nach Typ und ID; „Workspace order“ setzt eine Marke und bleibt im Schritt."
  - key: kv63
    text: "Gegeben „New saved filter“ wird gewählt, wenn die Befehlszeile weitergeht, dann fragt sie nacheinander Name, Bedingung und Sortierung wie AK2; der übernehmende Treffer der Bedingung heißt „Next: sort“, und „Save“ speichert ohne Sortierschlüssel keine Sortierung."
  - key: vnsd
    text: Gegeben „New perspective“ oder „New saved filter“ fragt den Namen, wenn getippt wird, dann zeigt die Befehlszeile die vorhandenen Perspektiven bzw. gespeicherten Filter als Treffer; passt der Name auf einen davon, ohne Rücksicht auf Groß- und Kleinschreibung und Unicode-Normalform, sagt die Zeile aus SR-210, dass er ersetzt wird, bei einem Buffer mit „modified“ (SR-214 AK6) auch, dass dessen Umstellungen verloren gehen.
  - key: wsw0
    text: Gegeben „New perspective“ oder „New saved filter“ in einem Schritt vor dem letzten, wenn der Schritt beantwortet wird, auch mit Ctrl+Enter, dann speichert die App nichts; Ctrl+Enter bietet die optionalen Argumente an, die kein Schritt sind (bei Perspektiven Beschreibung und gespeicherter Filter, bei gespeicherten Filtern Beschreibung und Sicht), und danach geht es mit dem nächsten Schritt weiter. Erst „Save“ im letzten Schritt führt den Befehl aus.
  - key: pqry
    text: Gegeben „New perspective“ oder „New saved filter“ in einem späteren Schritt, wenn Escape oder in leerer Eingabe ohne Marke dieses Schritts die Rücktaste gedrückt wird, dann zeigt die Befehlszeile den vorigen Schritt mit seinen Antworten und Marken (SR-134 AK1, AK4, SR-215 AK9); jeder Schritt zeigt die Marken der Schritte davor ohne ×. Ein Klick außerhalb schließt sie, ohne zu speichern (SR-134 AK3).
  - key: k5p2
    text: Gegeben „Save“ wurde gewählt, wenn der Befehl gelingt, dann öffnet „New perspective“ die Perspektive als eigenen Buffer, wie sie gespeichert ist (SR-214 AK2), sie steht in „Open perspective“ zuerst (SR-214 AK1), und die Befehlszeile meldet „Saved perspective <Name>“; „New saved filter“ meldet „Saved filter <Name>“, und die gezeigte Ansicht bleibt, wie sie ist. Lehnt der Befehl ab, zeigt die Befehlszeile den Schritt des abgelehnten Arguments mit der Meldung, sonst den letzten, und die Antworten aller Schritte stehen wieder da.
  - key: zznw
    text: Gegeben eine Liste von Elementen, außer der Liste der Suchtreffer, den Elementen einer Paketseite, einer Liste aus der Ausgabe eines Befehls, einer Liste im Modus der Matrix und einer Liste, deren Auswahl einen gespeicherten Filter nennt, wenn „Save list as saved filter“ gewählt wird, dann fragt die Befehlszeile nur nach dem Namen wie AK4 und speichert die Bedingungen der Filterschritte in ihrer Reihenfolge, die Sortierung, wenn sie mit „Sort list“ gewählt oder mit der Perspektive der Liste gespeichert ist, und keine Sicht; bei einer gruppierten Liste sagt die Zeile aus SR-210, dass die Gruppierung nicht zu einem gespeicherten Filter gehört. Danach meldet sie „Saved filter <Name>“, und die Liste bleibt, wie sie ist.
  - key: kj5g
    text: Gegeben „Save list as saved filter“ hat gespeichert, wenn `filter.save` über Kommandozeile, API oder MCP-Server mit dem Namen, den Bedingungen der Filterschritte in ihrer Reihenfolge unter `all` und der Sortierung nach AK8 aufgerufen wird, dann schreibt es dieselbe Datei.
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
verification-method: test
derives-from:
  - { id: 6adc50a5-7bcc-4472-8749-22e86aaf86bd, version: n2:f032ba6e52d789ed, title: Filter speichern }
  - { id: cbfe7443-9220-429d-a879-93d5c730a7fe, version: n2:43968194ec3757d7, title: Einfacher Einstieg in die Daten }
  - { id: 61d4ffa4-bfc0-42c8-a7ef-d867c0ba286c, version: n2:675fa2767fc2398d, title: Befehle finden und Kürzel lernen }
refines:
  - { id: 39cd1be4-4927-4c92-ace2-2ea5eb9fde56, version: n2:05176b3d9f1a47cc, title: In der App zwischen Perspektiven wechseln }
  - { id: 30bb227d-2fc6-40d0-8450-2318af473702, version: n2:0ff87a9bd44b4435, title: Argumente mit festen Werten in der Befehlszeile aus den Treffern wählen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:cf0f20e3864572ec, title: Oberfläche als weißes Blatt }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:3795ac071493804f, title: API und MCP-Server neben der App }
---

Die App muss einen gespeicherten Filter aus der gezeigten [Liste von Elementen](reqseq:a6eba69f-df0b-490c-8bc2-a22659e9d1f7?version=n2:7efa122135fa30f9) mit nur einem Namen speichern lassen, wie eine [Perspektive](reqseq:bdee772f-96c2-4c77-b180-f06f9d8c795a?version=n2:3080b7f3f9c464c9) (SR-214), und Perspektiven und gespeicherte Filter ohne Liste in der [Befehlszeile](reqseq:8014c1d5-3d19-4c70-8d12-5696db492f77?version=n2:a3b284c17b1349e8) Schritt für Schritt neu aufbauen lassen; dabei speichert sie erst nach dem letzten Schritt.
