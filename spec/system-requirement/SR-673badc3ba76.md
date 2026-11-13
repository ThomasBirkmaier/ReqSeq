---
id: f31c72b6-c22c-42b4-b1b0-673badc3ba76
type: system-requirement
status: approved
title: Perspektive als Datei speichern und über alle Zugänge aufrufen
spec-id: SR-213
rationale: "Eine Liste, die man sich aus Filtern, Gruppierung und Sortierung aufgebaut hat, wird immer wieder gebraucht, zum Beispiel alle System Requirements im Status draft nach Paket gruppiert. Die Perspektive speichert, wie eine Liste aussieht; der gespeicherte Filter (SR-070) bleibt die Auswahl für Abdeckung, Baseline und Matrix. Die Perspektive speichert keine Sicht; es gilt die Sicht des Fensters (SR-043), über die anderen Zugänge `selection.view`. Gruppierung, die sich nicht mehr wählen lässt (AK7): Die Werte einer Property mit Text, Zahl oder Datum können durch neue Daten zu viele werden; eine geteilte Perspektive soll sich trotzdem öffnen lassen. Ändern sich die Daten oder der gespeicherte Filter, während die Liste einer Perspektive in der App offen ist, gelten AK6 und AK7 erst beim erneuten Öffnen; bis dahin meldet die offene Liste den Grund, aus dem sie sich nicht mehr laden lässt. Perspektiven gelten für den ganzen Arbeitsbereich; der Elementtyp ist nur eine Bedingung, sodass eine Perspektive auch mehrere Typen umfassen kann. Fehlerhafte Dateien (AK8) meldet das Auflisten wie bei gespeicherten Filtern; die Prüfung des Bestands prüft Perspektiven nicht."
requirement-type: functional
acceptance-criteria:
  - key: vkfg
    text: Gegeben eine Auswahl mit Bedingungen und optional einem gespeicherten Filter, eine Gruppierung und eine Sortierung, wenn sie als Perspektive mit Namen gespeichert werden, dann entsteht eine YAML-Datei im Ordner `perspectives` des Haupt-Repositorys oder an dem Ort, den die Arbeitsbereichs-Datei für Perspektiven nennt; eine Sicht speichert die Perspektive nicht.
  - key: dyjq
    text: Gegeben eine gespeicherte Perspektive, wenn eine andere lokale Kopie des Repositorys geöffnet wird, zum Beispiel von einer anderen Person, dann steht dort die Perspektive zur Verfügung.
  - key: mfbk
    text: Gegeben eine gespeicherte Perspektive, wenn eine Perspektive unter demselben Namen gespeichert wird, auch in anderer Groß- und Kleinschreibung oder Unicode-Normalform, dann ersetzt sie sie in derselben Datei, das Tool ändert nur die Zeilen der geänderten Angaben, Kommentare auf unveränderten Zeilen und die Beschreibung bleiben stehen, und in der Datei steht der Name, wie er zuletzt gespeichert wurde.
  - key: gcgz
    text: Gegeben eine Perspektive, wenn `element.list` sie über Kommandozeile, API oder MCP-Server beim Namen aufruft, in derselben Sicht wie die App, dann liefert das Tool dieselben Elemente und, vom Abschnitt am Ende abgesehen (SR-201), dieselben Gruppen in derselben Reihenfolge wie die App.
  - key: ynyk
    text: Gegeben `element.list` mit einer Perspektive und eigener Auswahl, Sortierung oder Gruppierung, wenn es aufgerufen wird, dann gilt die Auswahl der Eingabe zusätzlich zu der der Perspektive, und Sortierung und Gruppierung der Eingabe gelten statt denen der Perspektive; nennt die Eingabe keine Sortierung und ihre Auswahl einen gespeicherten Filter, der eine Sortierung speichert, gilt dessen Sortierung als Sortierung der Eingabe.
  - key: tj6p
    text: Gegeben eine Perspektive, die einen gespeicherten Filter nennt, wenn der Filter neu gespeichert wurde, dann gilt beim nächsten Aufruf seine neue Bedingung; gibt es den Filter nicht oder ist seine Datei fehlerhaft, lehnt das Tool den Aufruf ab und nennt Perspektive und Filter.
  - key: zz87
    text: Gegeben eine Perspektive mit einer Gruppierung nach einer Property, deren Werte sich nach SR-124 AK2 nicht mehr auswählen lassen, wenn sie ohne eigene Gruppierung aufgerufen wird, in der App beim Öffnen, dann liefert das Tool die Liste ohne Gruppen und meldet, dass sich danach nicht gruppieren lässt, in der App wie über die anderen Zugänge.
  - key: qp6d
    text: Gegeben eine fehlerhafte Perspektiven-Datei, wenn die Perspektiven aufgelistet werden, dann nennt das Tool Datei und Grund, listet die übrigen Perspektiven und überschreibt die Datei nie von selbst (SR-008).
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:b9b03ddc1ea7cb2d, title: Finden und Listen }
verification-method: test
derives-from:
  - { id: 6adc50a5-7bcc-4472-8749-22e86aaf86bd, version: n2:f032ba6e52d789ed, title: Filter speichern }
based-on:
  - { id: 6adc78cf-bdda-461d-9245-ee53800698fb, version: n2:3bcd34b03d5f6b06, title: Aufbau der Dateien mit fester Länge des Dateinamens }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:3795ac071493804f, title: API und MCP-Server neben der App }
---

Das Tool muss eine [Liste von Elementen](reqseq:a6eba69f-df0b-490c-8bc2-a22659e9d1f7?version=n2:7efa122135fa30f9) mit ihrer [Auswahl](reqseq:f0c30c41-91fa-4ac5-8e7c-9054c84ccfc8?version=n2:71ff4ed89affd70e), ihrer Gruppierung und ihrer Sortierung als [Perspektive](reqseq:bdee772f-96c2-4c77-b180-f06f9d8c795a?version=n2:3080b7f3f9c464c9) mit Namen als Datei im [Repository](reqseq:62da75c7-9827-47d1-9566-5bf509291b94?version=n2:a0761b06955a7b20) speichern und jede Perspektive über App, [Kommandozeile](reqseq:f5c404b5-7886-4c69-af41-5ecc43b71f52?version=n2:9a4f0d8d27de42ba), API und MCP-Server beim Namen aufrufen lassen.
