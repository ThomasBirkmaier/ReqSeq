---
id: 08ee8add-ef27-4972-ab4c-e0b8bcad916e
type: decision
status: accepted
title: Kontextmenü per Rechtsklick
spec-id: D-075
based-on:
  - { id: da7c347e-2b28-4036-9d64-0cdcd0445751, version: n2:4cfed2babc45e7f3, title: Text als Markdown mit Live-Vorschau }
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:2ec3810c4995e7aa, title: Oberfläche als weißes Blatt }
supersedes:
  - { id: 2d990242-8c7d-4d5b-af55-b149cb921241, version: n2:762937fdaffa998b, title: Mausbedienung im Editor am Ort der Sache }
---

Ein Rechtsklick öffnet an der Stelle des Mauszeigers ein Kontextmenü mit einer kurzen, festen Auswahl der Befehle, die zu dieser Stelle passen, zum Beispiel im Text, an einem Feld, an einer Listenzeile, an einem Knoten im Graphen oder an einer Zelle der Matrix ([SR-194](reqseq:1faf2c14-c73c-45d7-862a-e9f1a217e6c9?version=n2:a224e91ffab29b01)). Jeder Eintrag zeigt den Namen des Befehls und sein Kürzel. Der letzte Eintrag „All commands…“ öffnet die Befehlszeile mit den zur Stelle passenden Befehlen zuerst ([SR-133](reqseq:00948f9c-6582-4484-8113-1f60f96fb7d8?version=n2:8aebe581afa5400a)). Das Menü ist ein eigenes, ruhiges Menü im Stil der App, nicht das Menü des Betriebssystems. Es bringt keine eigenen Funktionen mit: Jeder Eintrag ist ein Befehl, den es auch in der Befehlszeile gibt.

Weiter gilt: Mit der Maus bearbeitet man den Text am Ort der Sache, zum Beispiel ein Häkchen einer Aufgabe anklicken, ein Bild hineinziehen oder einen Listeneintrag verschieben. Formatierungen gibt es als Befehle der Befehlszeile und im Kontextmenü des Textes. Es gibt keine Leiste bei markiertem Text und kein Menü „Format“ im Programm-Menü.

Grund: Wer nur die Maus gewohnt ist, erwartet den Rechtsklick und soll die App bedienen können, ohne Kürzel und Namen von Befehlen zu kennen ([N-082](reqseq:f7e0d304-30ac-43c8-9683-1c432a0f119a?version=n2:2d5ec8cb0a706279), [N-055](reqseq:6adc5a7a-c3a4-4a8a-8a2e-49131b717bb0?version=n2:3f292d3254c41848)). Das Kontextmenü ist nach dem Slash-Menü die zweite Ausnahme von der einzigen Bedienstelle in [D-062](reqseq:c14efb7d-59da-4ef5-9b85-626310b9a57e?version=n2:2ec3810c4995e7aa): Es erscheint erst auf Anforderung und zeigt nur Befehle der Befehlszeile, so bleiben die Grundregel des weißen Blatts und die gleichen Funktionen in allen Zugängen ([D-029](reqseq:6adc5c64-fe36-4191-85d8-c57756a89310?version=n2:3795ac071493804f)) gewahrt. Es löst [D-073](reqseq:2d990242-8c7d-4d5b-af55-b149cb921241?version=n2:762937fdaffa998b) ab, das ein Kontextmenü ausschloss. Verworfen sind das Menü des Betriebssystems, das nicht zum Stil der App passt und sich nicht wie die übrige App automatisch prüfen lässt, und ein Menü mit allen passenden Befehlen, das an einem Element rund 30 Einträge hätte.
