---
id: 2bf609c1-c538-4a81-8bf4-4bb03adcbaef
type: system-requirement
status: approved
title: Perspektiven und gespeicherte Filter umbenennen und löschen
spec-id: SR-217
rationale: Perspektiven und gespeicherte Filter sind Dateien des Tools, keine Elemente; D-045 und SR-099 betreffen sie nicht. Anders als bei Element-Dateien (D-056) wird beim Umbenennen auch die Datei umbenannt, weil ihr Dateiname aus dem Namen gebildet ist und sonst einen falschen Namen zeigt. Gelöscht wird erst nach Bestätigung, weil eine Datei, die Git noch nicht kennt, danach nicht wiederkommt. Ist nicht sicher, dass keine Perspektive und keine Baseline einen Filter mehr nennt, lehnt das Tool ab, damit nichts unbemerkt nicht mehr aufrufbar ist; Baseline-Dateien ändert das Tool nicht. Skripte, die einen Filter beim Namen aufrufen, kennt das Tool nicht. Benennen zwei Branches denselben Filter verschieden um, ist das ein Konflikt in Git; nennt nach dem Zusammenführen eine Perspektive einen Filter, den es nicht mehr gibt, meldet SR-213 AK6 das.
requirement-type: functional
acceptance-criteria:
  - key: f79t
    text: Gegeben eine Perspektive oder ein gespeicherter Filter, wenn sie unter einem neuen Namen umbenannt werden, dann steht in ihrer Datei der neue Name, die Datei heißt nach AK2, Kommentare auf unveränderten Zeilen und die Beschreibung bleiben stehen, ein Aufruf beim neuen Namen liefert dasselbe wie vorher beim alten, und den alten Namen kennt das Tool nicht mehr.
  - key: yt8d
    text: Gegeben ein Name, wenn das Tool für ihn eine Datei anlegt oder eine Datei auf ihn umbenennt, dann heißt die Datei aus den Buchstaben und Ziffern des Namens in Kleinbuchstaben ohne Akzente, mit `-` dazwischen, höchstens 64 Zeichen, mit der Endung `.yaml`; ohne Buchstaben und Ziffern heißt sie `filter` bzw. `perspective`, der Name eines Windows-Geräts wie `con` oder `nul` bekommt `-` und dieses Wort, und hat der Ordner schon einen Eintrag dieses Namens ohne Rücksicht auf Groß- und Kleinschreibung, hängt das Tool `-2`, `-3` … an. Beim Umbenennen zählt die eigene Datei nicht als belegt; heißt sie schon so, auch in anderer Groß- und Kleinschreibung, bleibt ihr Dateiname.
  - key: dp5h
    text: Gegeben ein neuer Name, den eine andere Perspektive bzw. ein anderer gespeicherter Filter trägt, ohne Rücksicht auf Groß- und Kleinschreibung und Unicode-Normalform, den nur eine fehlerhafte Datei hält oder der gegen die Regeln für Namen verstößt wie beim Speichern, wenn umbenannt werden soll, dann lehnt das Tool ab, nennt den Grund und, wo es eine gibt, die Datei, und ändert nichts. Ändert der neue Name nur die Schreibweise des eigenen Namens, benennt das Tool um; gleicht er dem alten Zeichen für Zeichen, schreibt es nichts. Ein gespeicherter Filter und eine Perspektive dürfen gleich heißen.
  - key: kv9r
    text: Gegeben ein gespeicherter Filter, den Perspektiven nennen, auch Perspektiven-Dateien, die eine andere Datei mit demselben Namen verdeckt, wenn er umbenannt wird, auch nur in der Schreibweise, dann schreibt das Tool den neuen Namen zuerst in jede dieser Perspektiven und zuletzt in den Filter und nennt die geänderten Perspektiven in der Ausgabe.
  - key: bxqr
    text: Gegeben eine Perspektive oder ein gespeicherter Filter, wenn das Löschen ohne Bestätigung aufgerufen wird, dann nennt das Tool Name und Datei und löscht nichts; mit Bestätigung prüft es alles neu (AK6, AK7) und löscht die Datei, der Ordner bleibt stehen.
  - key: fhyv
    text: Gegeben ein gespeicherter Filter, wenn er gelöscht werden soll und eine Perspektive ihn nennt, oder wenn er umbenannt oder gelöscht werden soll und eine Baseline-Datei ihn beim Namen nennt, eine fehlerhafte Perspektiven- oder Baseline-Datei ihn nennt oder sich nicht als YAML lesen lässt, das Repository des Ordners der Perspektiven oder des Ordners für Baselines (D-039) lokal fehlt oder sich einer dieser Ordner nicht lesen lässt, dann lehnt das Tool ab, beim Löschen schon ohne Bestätigung, nennt die Dateien, die Ordner bzw. die Repositories und ändert nichts.
  - key: q14p
    text: Gegeben eine Datei, die umbenannt, gelöscht oder mitgeändert werden soll, liegt in einem Ordner `.git` (SR-083 AK4), ihr Repository fehlt lokal, sie wurde seit dem Lesen außen geändert, der Name steht nur in einer fehlerhaften Datei, oder das Tool lehnt Schreibbefehle ab (SR-011 AK3), wenn umbenannt oder gelöscht wird, dann lehnt das Tool ab, nennt Datei und Grund und ändert keine Datei. Lässt sich eine Datei erst beim Schreiben nicht schreiben, bricht das Tool ab und nennt die schon geänderten Dateien und die Datei mit ihrem Grund; derselbe Aufruf noch einmal schließt das Umbenennen ab.
  - key: z7rb
    text: Gegeben derselbe Arbeitsbereich, wenn dieselbe Perspektive oder derselbe gespeicherte Filter mit derselben Eingabe über Kommandozeile, API oder MCP-Server umbenannt oder gelöscht wird, dann stehen danach dieselben Dateien mit demselben Inhalt im Arbeitsbereich, und die Ausgabe nennt dieselben Dateien.
packages:
  - { id: ba811685-2a69-43cb-aea4-9c5cf9c4e9a3, version: n2:b9b03ddc1ea7cb2d, title: Finden und Listen }
verification-method: test
derives-from:
  - { id: 6adc50a5-7bcc-4472-8749-22e86aaf86bd, version: n2:f032ba6e52d789ed, title: Filter speichern }
based-on:
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:b68c1780920b121b, title: API und MCP-Server neben Kommandozeile und Web-Oberfläche }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n2:c433f023b7b96248, title: Das Tool liest Git nur }
refines:
  - { id: 6adc6d8b-056d-4adf-9fb6-fdd42fc61300, version: n2:8165fdcf3ba80051, title: Filter als Datei speichern }
  - { id: f31c72b6-c22c-42b4-b1b0-673badc3ba76, version: n2:9759ea361384ff76, title: Perspektive als Datei speichern und über alle Zugänge aufrufen }
---

Das Tool muss [Perspektiven](reqseq:bdee772f-96c2-4c77-b180-f06f9d8c795a?version=n2:3080b7f3f9c464c9) und gespeicherte Filter über [Kommandozeile](reqseq:f5c404b5-7886-4c69-af41-5ecc43b71f52?version=n2:9a4f0d8d27de42ba), API und MCP-Server umbenennen und nach Bestätigung löschen lassen; benennt es einen gespeicherten Filter um, ändert es die Perspektiven mit, die ihn nennen.
