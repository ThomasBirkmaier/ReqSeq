---
id: 82fd4d1b-0df8-4bb4-91d4-4635cf9ddcc3
type: decision
status: draft
title: Befehle, die Befehle zusammenstellen
spec-id: D-082
based-on:
  - { id: 7a120e78-ad90-4f95-b966-6017460b8538, version: n2:0a97d893f4ac8dde, title: "Ein Befehl je Tätigkeit, Werte als Schritte" }
  - { id: 177556f3-8d4f-434d-8cc8-04def92b4fa4, version: n2:116c000ecfa592b6, title: Ausgaben gestuft zeigen }
  - { id: 6ad47f0f-552c-42de-aa78-27c9c18f3d6b, version: n2:24b59ed5af881fec, title: Anlass einer Baseline liegt außerhalb des Tools }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:3795ac071493804f, title: API und MCP-Server neben der App }
  - { id: 6adc4eb0-23e6-4e81-9ae8-e964fba47a8d, version: n2:882381883f0fb18e, title: Zusammenarbeit liegt außerhalb des Tools }
---

Für eine Arbeit, die sonst mehrere Befehle nacheinander braucht, kann das Tool einen Befehl anbieten, der die [Ausgaben](reqseq:840d00df-60ed-4742-9b82-9e712f270449?version=n2:164509d02ae16783) vorhandener Befehle zusammenstellt und die nächsten Schritte als Befehle nennt, zum Beispiel „Show changes since baseline“ und „Prepare baseline“. Ein solcher Befehl liest nur. Jede Zahl, die er nennt, liefert auch ein vorhandener Befehl; weicht dessen Eingabe von der eigenen ab, nennt die Ausgabe sie. Er sperrt keinen Befehl, und er kennt keinen Anlass außerhalb des Tools, etwa die Einigung der Stakeholder ([D-006](reqseq:6ad47f0f-552c-42de-aa78-27c9c18f3d6b?version=n2:24b59ed5af881fec)).

Grund: Eine Arbeit aus mehreren Befehlen geht mit einem Befehl, ohne dass das Tool einen Ablauf vorgibt ([D-006](reqseq:6ad47f0f-552c-42de-aa78-27c9c18f3d6b?version=n2:24b59ed5af881fec), [D-014](reqseq:6adc4eb0-23e6-4e81-9ae8-e964fba47a8d?version=n2:882381883f0fb18e)).
