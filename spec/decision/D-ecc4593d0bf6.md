---
id: 6adc615d-b1c4-489a-8843-ecc4593d0bf6
type: decision
status: accepted
title: "Unterschiede zeigt die Versionsverwaltung"
spec-id: "D-033"
---

Bei einem veralteten Verweis oder Nachweis zeigt das Tool, dass er veraltet ist, und das Datum der alten Fassung ([D-013](reqseq:6adc4946-b44c-4ae1-8dbf-fb9e88b8c607?version=n2:fa0fbf62535d1e3c)).

Den Unterschied zwischen zwei Fassungen oder Baselines zeigen Git und der Git-Server ([D-014](reqseq:6adc4eb0-23e6-4e81-9ae8-e964fba47a8d?version=n2:882381883f0fb18e), [D-024](reqseq:6adc5a79-32fa-4834-88e9-f88d296ea3f1?version=n2:aa2bf102dceb7774)). Eine Anzeige weiterer Unterschiede im Tool, etwa zwischen zwei beliebigen Fassungen oder zwischen zwei Baselines, gehört zur Erweiterung, nicht zum Basisumfang.

Ausnahmen: Den Unterschied einer Variante zum Kern ([N-021](reqseq:6ad3a422-7a13-458e-87c5-cf0c3829c511?version=n1:674bb62923239dd9)) und die Änderungen bei einem wiederholten Import ([N-043](reqseq:6adc503f-9130-4391-a5c2-137d5e134f61?version=n1:fe05686bad283bf1)) zeigt das Tool selbst. Den Unterschied eines Elements zu seiner Fassung in einer Baseline liefert das Tool als Ausgabe eines Befehls in allen Zugängen, weil eine Oberfläche oder ein Agent, die nur die Befehle des Tools aufrufen, ihn sonst selbst aus Git bilden müssten; der [HTML-Export](reqseq:7f240c30-80c6-476d-bc9c-0215a0fef867?version=n2:7e08d73bbf3cc65a) ([D-080](reqseq:b413f77d-743e-4abe-8b79-bceb24c4b7ca?version=n2:a14b879b0af2da59)) zeigt ihn, weil seine Leser weder Git noch den Git-Server haben. Review und Historie bleiben bei der Versionsverwaltung ([D-014](reqseq:6adc4eb0-23e6-4e81-9ae8-e964fba47a8d?version=n2:882381883f0fb18e)).

Grund: Git zeigt Unterschiede zwischen Markdown-Dateien ([D-015](reqseq:6adc4ee9-4ac6-485f-a1c3-43352a58580f?version=n2:47d7dc2726d0c379)) bereits zuverlässig. Das Tool bleibt klein.
