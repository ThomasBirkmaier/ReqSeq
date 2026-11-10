---
id: 6adc78d3-0812-43dc-94fe-7af63b9acd96
type: decision
status: accepted
title: "Bedeutungen und Standardmodell vervollständigt"
spec-id: "D-059"
---

Fest eingebaut ([D-012](reqseq:6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc?version=n2:b98a6de8c51aee04)) sind diese Bedeutungen, die das Metamodell Schlüsseln zuordnet: ID, Kennung ([D-017](reqseq:6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2?version=n1:5d89499f58e06be2)), Typ, Status, Ableitung (Parent-Child), Gültigkeit ([D-020](reqseq:6adc5316-641d-4817-964e-8803a78ac710?version=n2:0cd25f27b89543f2)), Ersetzt (eine Variante ersetzt ein Kern-Requirement), Ablösen (ein Element wird ungültig, optional mit einem Nachfolger, [D-045](reqseq:6adc6923-8957-4ae9-8e6c-dc5cd1d097c8?version=n2:a15ab2601a95ce60)), Ausschluss, Paketzugehörigkeit ([D-040](reqseq:6adc6920-0efc-478d-b91c-4ca42caaa8a8?version=n2:e84656cd8b820df6)), Emergentes Verhalten, ungültiger Status ([D-044](reqseq:6adc6922-e6d1-4d0a-9617-83d65c71cf7f?version=n2:c749fac931762a0f)), zählt zur Fassung ([D-057](reqseq:6adc78d0-70c6-4553-afd0-f972137d5459?version=n2:3fcf9278ab2c5f2b)), Nachweis und Validierung ([D-007](reqseq:6ad49d01-5018-4d89-9350-37989131ccc1?version=n2:1b2559391ba2c4a7)), Akzeptanzkriterien eines Requirements ([D-072](reqseq:3d5793a1-a4d5-493c-892b-c1b1dded5eca?version=n2:c98e4d2e2b546d5d)).

Das Standardmodell ([D-037](reqseq:6adc691e-6394-45b3-a796-31e830aa3392?version=n2:3e0c480389b79547)) enthält zusätzlich die Properties Package, Emergent, Verification Method und Statement sowie für die Herkunft Source, Source Identifier, Import Date, Delivery und Import Version; eine Variante nennt ihre Ausschlüsse in der Property Excludes.

Ersetzt und Ablösen sind zwei getrennte Bedeutungen. Import Version hat die Bedeutung Importfassung: die Fassung, die die zuletzt importierte Lieferung für das Element ergibt. Nur der Import schreibt sie, und sie zählt nicht zur Fassung. Grund: So erkennt ein wiederholter Import, ob ein Element seit dem letzten Import lokal geändert wurde (Entscheidung des Produktverantwortlichen, 2026-10-29).

Component Requirements kommen erst mit der Architektur.
