---
id: e4ccf89c-0e6f-4cd4-8632-c1c8d8e2f80c
type: decision
status: accepted
title: Frühere Dateiformate werden nicht gelesen
spec-id: D-076
based-on:
  - { id: 6adc58f6-3aa2-4478-b345-670b5cbb1127, version: n2:66a078362949a01f, title: Normalform der Fassung }
  - { id: 6ad4a03f-d7cf-4b85-98da-3f4431f33fe7, version: n2:84d08b2dbd1bf992, title: Auswertungen mit externen Werkzeugen }
---

Das Tool liest und schreibt jede seiner Dateien nur im Format seiner eigenen Version. Eine Datei mit einer Formatnummer oder Schreibweise, die es nicht kennt, auch der einer früheren Version, meldet es als fehlerhaft, verwendet ihren Inhalt nicht und wandelt sie nicht um ([SR-008](reqseq:6adc6acb-a6e4-4ffc-9258-3dbe90fc40b9?version=n2:909da44c840a66f1) AK4); seine Ausgaben haben nur die Form seiner eigenen Version. Das gilt für Element-Dateien, Metamodell, Arbeitsbereichs-Datei und lokale Datei des Arbeitsbereichs, Zuordnungen, gespeicherte Filter, die Dateien der Daten je Stand und die Dateien im Ordner des Zwischenspeichers.

Ausgenommen sind die Daten, die Nutzer seit Version 0.7.2 mit dem Tool ablegen: die gespeicherten Fassungen in Beziehungen, Verweisen und Datensätzen ([D-027](reqseq:6adc58f6-3aa2-4478-b345-670b5cbb1127?version=n2:66a078362949a01f)), die Nachweis-Datensätze ([D-026](reqseq:6adc58f5-a349-4870-af2f-971ec1cee679?version=n2:7ad54b00f062ca52)) und die Baselines ([D-039](reqseq:6adc691f-cfbf-4934-9504-21c1fc5849f7?version=n2:c39ce145802bd72b)). Jede spätere Version liest sie weiter und lässt sie so gelten, wie sie abgelegt wurden.

Grund: Bis Version 0.7.2 gab es außer in Tests keine Nutzer und keine älteren Dateien; Code für frühere Formate hätte Umfang und Prüfaufwand gekostet, ohne dass ihn jemand braucht (Entscheidung des Produktverantwortlichen, 2026-10-29). Seit Version 0.7.2 legen Nutzer Fassungen, Nachweise und Baselines ab, die sich nicht neu erzeugen lassen; eine neue Version darf sie nicht ungültig machen (Entscheidung des Produktverantwortlichen, 2026-11-05).
