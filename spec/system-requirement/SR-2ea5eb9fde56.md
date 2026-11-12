---
id: 39cd1be4-4927-4c92-ace2-2ea5eb9fde56
type: system-requirement
status: approved
title: In der App zwischen Perspektiven wechseln
spec-id: SR-214
rationale: "Schnell zwischen Listen wechseln, zum Beispiel alle System Requirements in draft und alle approved. Ctrl+P und Ctrl+N bewegen in Listen und auf der Übersicht die Markierung (SR-122 AK4, AK5); deshalb hat das Wechseln eine eigene Taste nach der Präfixtaste. Die übrigen Buchstaben nach der Präfixtaste kommen weiter aus der Tastenbelegung der App. Reihenfolge der Treffer (AK1): Wer zwischen wenigen Perspektiven hin und her wechselt, findet die zuletzt geöffnete zuerst. Speichern (AK5): Die Liste der Suchtreffer steht nach Relevanz und lässt sich nicht sortieren (SR-075 AK4), die Elemente einer Paketseite lassen sich nicht gruppieren (SR-112), und die Matrix zeigt keine Gruppen; das Kontextmenü einer Liste bleibt bei seiner festen Auswahl (SR-198). Ein vorhandener Name wird ohne Rückfrage ersetzt wie bei gespeicherten Filtern (SR-070 AK4); die Befehlszeile zeigt die vorhandenen Perspektiven beim Tippen. „modified“ (AK6) statt „changed“, weil die Statuszeile „changed on disk“ für außen geänderte Dateien zeigt. Ändert sich die Datei einer offenen Perspektive außen, bleibt die Liste, wie sie ist, bis die Perspektive erneut geöffnet wird. Der Abschnitt auf der Übersicht steht in SR-118."
requirement-type: functional
acceptance-criteria:
  - key: sd9r
    text: Gegeben ein Arbeitsbereich mit Perspektiven, wenn die Präfixtaste und dann V gedrückt wird (Ctrl+K V, unter macOS Cmd+K V) oder der Befehl „Open perspective“ gewählt wird, dann zeigt die Befehlszeile nur die Perspektiven, die zuletzt geöffneten zuerst, dann nach Namen, und grenzt sie beim Tippen mit unscharfer Suche ein; ohne Perspektive meldet sie, dass es keine gibt.
  - key: kqd2
    text: Gegeben eine Perspektive wird in der Befehlszeile gewählt, wenn Enter gedrückt wird, dann öffnet die App sie als eigenen Buffer mit ihrem Namen als Überschrift, ihrer Auswahl als erstem Filterschritt, ihrer Gruppierung und ihrer Sortierung, in der Sicht des Fensters.
  - key: wngq
    text: Gegeben zwei Perspektiven A und B, wenn erst A und dann B geöffnet wird, dann sind beide als eigene Buffer offen, und Alt+P zeigt wieder A.
  - key: rgnq
    text: Gegeben der Buffer einer Perspektive ist offen und weicht von ihr ab, wenn die Perspektive erneut geöffnet wird, dann zeigt die App diesen Buffer wieder so, wie die Perspektive gespeichert ist.
  - key: bzs1
    text: Gegeben eine Liste von Elementen, außer der Liste der Suchtreffer, den Elementen einer Paketseite und einer Liste im Modus der Matrix, wenn „Save list as perspective“ gewählt wird, dann fragt die Befehlszeile nur nach dem Namen, schlägt den Namen der Perspektive vor, aus der die Liste kommt, zeigt beim Tippen die vorhandenen Perspektiven und speichert Filterschritte, Gruppierung und die gezeigte Sortierung der Liste.
  - key: fgs9
    text: Gegeben der Buffer einer Perspektive, wenn ein Filterschritt hinzukommt oder entfällt oder Gruppierung oder Sortierung umgestellt werden, dann zeigt die Statuszeile nach dem Namen „modified“; nach dem Speichern unter diesem Namen oder dem erneuten Öffnen der Perspektive steht es nicht mehr da. „Clear all list filters“ nimmt nur die Schritte nach der Auswahl der Perspektive zurück.
  - key: sf7b
    text: Gegeben offene Buffer von Perspektiven, wenn die App neu gestartet wird, dann sind sie wieder da und zeigen die Perspektive, wie sie gespeichert ist, mit Gruppierung; ungespeicherte Umstellungen gehen verloren, und der Buffer einer Perspektive, die es nicht mehr gibt, kommt nicht wieder.
packages:
  - { id: 5c0075c7-0fad-483a-b35e-af77d1499468, version: n2:23c8afe7316d80f6, title: Bedienung der App }
verification-method: test
derives-from:
  - { id: cbfe7443-9220-429d-a879-93d5c730a7fe, version: n2:43968194ec3757d7, title: Einfacher Einstieg in die Daten }
  - { id: 61d4ffa4-bfc0-42c8-a7ef-d867c0ba286c, version: n2:675fa2767fc2398d, title: Befehle finden und Kürzel lernen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:723848211e07119a, title: Oberfläche als weißes Blatt }
refines:
  - { id: 0f759f3b-b03d-42f5-a38a-b0ca831ca864, version: n2:3eed09fb96e61f0a, title: In Buffern arbeiten }
  - { id: 784dfd2a-c6c6-4e7a-8e3a-b46a977e700e, version: n2:35bd2dc7e36cec6b, title: Statuszeile zeigen }
---

Die App muss jede [Perspektive](reqseq:bdee772f-96c2-4c77-b180-f06f9d8c795a?version=n2:3080b7f3f9c464c9) über die [Präfixtaste](reqseq:380e1b2e-8fd2-4689-b37f-1e5c61cd2d7b?version=n2:0c84f72fd8fd6271) und V in der [Befehlszeile](reqseq:8014c1d5-3d19-4c70-8d12-5696db492f77?version=n2:a3b284c17b1349e8) auffindbar machen, sie als eigenen [Buffer](reqseq:0dec8101-c777-49b0-8516-3cb674573638?version=n2:a6ae4348e2f95e2c) öffnen, wie sie gespeichert ist, und eine [Liste von Elementen](reqseq:a6eba69f-df0b-490c-8bc2-a22659e9d1f7?version=n2:7efa122135fa30f9) als Perspektive speichern lassen.
