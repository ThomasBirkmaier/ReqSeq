---
id: 177556f3-8d4f-434d-8cc8-04def92b4fa4
type: decision
status: accepted
title: Antwortsatz und Angaben aus dem Befehlskatalog
spec-id: D-078
based-on:
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:b68c1780920b121b, title: API und MCP-Server neben Kommandozeile und Web-Oberfläche }
---

Jede [Ausgabe eines Befehls](reqseq:840d00df-60ed-4742-9b82-9e712f270449?version=n2:1da2b0546525b3fa) enthält den [Antwortsatz](reqseq:d249a00b-83d2-4c62-b42a-f2c929b5ce27?version=n2:9e00b6ad928fc47b). Titel, Antwortsatz und die Kennzeichen „technisch“ und „Zahl von Elementen“ kommen aus dem Befehlskatalog und dem Kern, damit alle Zugänge dasselbe liefern.

Grund: Titel, die nur ein Zugang führt, wären doppelt gepflegt und gälten nur dort.
