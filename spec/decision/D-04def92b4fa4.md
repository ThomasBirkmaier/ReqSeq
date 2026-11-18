---
id: 177556f3-8d4f-434d-8cc8-04def92b4fa4
type: decision
status: accepted
title: Ausgaben gestuft zeigen
spec-id: D-078
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n2:723848211e07119a, title: Oberfläche als weißes Blatt }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:3795ac071493804f, title: API und MCP-Server neben der App }
---

Die App zeigt die [Ausgabe eines Befehls](reqseq:840d00df-60ed-4742-9b82-9e712f270449?version=n2:f75f336199aced66) gestuft: zuerst ihren [Antwortsatz](reqseq:d249a00b-83d2-4c62-b42a-f2c929b5ce27?version=n2:a8f6683763f8c15a), darunter nur, was Handlung verlangt oder die Antwort trägt, und technische Angaben auf Abruf mit einem Befehl je Buffer. Elemente in einer Ausgabe sind eine Liste wie jede andere. Ein Schreibbefehl öffnet keine Ausgabe, außer der Befehlskatalog kennzeichnet ihn so; der gezeigte Buffer bleibt, und die Befehlszeile meldet den Antwortsatz. Titel, Antwortsatz und die Kennzeichen der Angaben kommen aus Befehlskatalog und Kern, damit alle Zugänge dasselbe liefern ([D-029](reqseq:6adc5c64-fe36-4191-85d8-c57756a89310?version=n2:3795ac071493804f)).

Grund: Eine Seite, die nicht sofort zeigt, was man sehen muss, überfordert. Eine Ausgabe nach Feldnamen, mit UUIDs, Prüfcodes und Commits, widerspricht der Grundregel von [D-062](reqseq:c14efb7d-59da-4ef5-9b85-626310b9a57e?version=n2:723848211e07119a). Verworfen sind ein Expertenmodus, weil eine Funktion dann nicht immer über ihren Namen auffindbar ist ([N-072](reqseq:61d4ffa4-bfc0-42c8-a7ef-d867c0ba286c?version=n2:675fa2767fc2398d)), und Titel nur in der App, weil sie dann doppelt gepflegt wären und nur dort gälten.
