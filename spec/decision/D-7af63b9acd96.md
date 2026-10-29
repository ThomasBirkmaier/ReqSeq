---
id: 6adc78d3-0812-43dc-94fe-7af63b9acd96
type: decision
status: accepted
title: "Bedeutungen und Standardmodell vervollständigt"
spec-id: "D-059"
---

Fest eingebaut ([D-012](reqseq:6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc?version=n1:24d0db5bd6fe4be0)) sind diese Bedeutungen, die das Metamodell Schlüsseln zuordnet: ID, Kennung ([D-017](reqseq:6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2?version=n1:5d89499f58e06be2)), Typ, Status, Ableitung (Parent-Child), Gültigkeit ([D-020](reqseq:6adc5316-641d-4817-964e-8803a78ac710?version=n1:98453db7e5f7bec6)), Ersetzt (eine Variante ersetzt ein Kern-Requirement), Ablösen (ein Nachfolger löst ein Element ab, [D-045](reqseq:6adc6923-8957-4ae9-8e6c-dc5cd1d097c8?version=n1:7b2e0416751f2b2b)), Ausschluss, Paketzugehörigkeit ([D-040](reqseq:6adc6920-0efc-478d-b91c-4ca42caaa8a8?version=n1:de2da62f92c63d52)), Emergentes Verhalten, ungültiger Status ([D-044](reqseq:6adc6922-e6d1-4d0a-9617-83d65c71cf7f?version=n1:e15d6e6acdfe3cc8)), zählt zur Fassung ([D-057](reqseq:6adc78d0-70c6-4553-afd0-f972137d5459?version=n1:403b6d5d854f3513)), Nachweis und Validierung ([D-007](reqseq:6ad49d01-5018-4d89-9350-37989131ccc1?version=n1:d0a8fdffb57622b1)).

Das Standardmodell ([D-037](reqseq:6adc691e-6394-45b3-a796-31e830aa3392?version=n1:63da2ba5c1572d36)) enthält zusätzlich die Properties Package, Emergent, Verification Method und Statement sowie für die Herkunft Source, Source Identifier, Import Date, Delivery und Import Version; eine Variante nennt ihre Ausschlüsse in der Property Excludes.

Ersetzt und Ablösen sind zwei getrennte Bedeutungen. Import Version hat die Bedeutung Importfassung: die Fassung des Elements direkt nach seinem letzten Import. Nur der Import schreibt sie, und sie zählt nicht zur Fassung. Grund: So erkennt ein wiederholter Import, ob ein Element seit dem letzten Import lokal geändert wurde (Entscheidung des Produktverantwortlichen, 2026-10-29).

Component Requirements kommen erst mit der Architektur.
