---
id: 6adc615d-b1c4-489a-8843-ecc4593d0bf6
type: decision
status: accepted
title: "Unterschiede zeigt die Versionsverwaltung"
spec-id: "D-033"
---

Bei einem veralteten Verweis oder Nachweis zeigt das Tool, dass er veraltet ist, und das Datum der alten Fassung ([D-013](reqseq:6adc4946-b44c-4ae1-8dbf-fb9e88b8c607?version=n1:0c3f2da31ca1ae9a)).

Den Unterschied zwischen zwei Fassungen oder Baselines zeigen Git und der Git-Server ([D-014](reqseq:6adc4eb0-23e6-4e81-9ae8-e964fba47a8d?version=n1:ccbefd504788a8ce), [D-024](reqseq:6adc5a79-32fa-4834-88e9-f88d296ea3f1?version=n1:cfec41db4d2067b9)). Eine Anzeige der Unterschiede im Tool gehört zur Erweiterung, nicht zum Basisumfang.

Ausnahmen: Den Unterschied einer Variante zum Kern ([N-021](reqseq:6ad3a422-7a13-458e-87c5-cf0c3829c511?version=n1:674bb62923239dd9)) und die Änderungen bei einem wiederholten Import ([N-043](reqseq:6adc503f-9130-4391-a5c2-137d5e134f61?version=n1:fe05686bad283bf1)) zeigt das Tool selbst.

Grund: Git zeigt Unterschiede zwischen Markdown-Dateien ([D-015](reqseq:6adc4ee9-4ac6-485f-a1c3-43352a58580f?version=n1:d6c378367fbf9eab)) bereits zuverlässig. Das Tool bleibt klein.
