---
id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc
type: decision
status: accepted
title: "Fest eingebaute Bedeutungen des Metamodells"
spec-id: "D-012"
---

Einige Bedeutungen sind fest eingebaut und lassen sich nicht ändern: Jedes Element hat ID, Typ und Status. Jede Beziehungsart ist entweder eine Parent-Child-Beziehung oder hat keine Bedeutung für die Traceability. Ein Nachweis verweist immer auf ein Requirement, eine Validierung auf einen Need oder ein Requirement.

Ebenfalls fest eingebaut sind: die Gültigkeit eines Requirements und die Beziehung „ersetzt“ (D-020), das Kennzeichen, ob eine Property zum Inhalt gehört ([D-013](reqseq:6adc4946-b44c-4ae1-8dbf-fb9e88b8c607?version=n1:0c3f2da31ca1ae9a)), das Kennzeichen für Emergentes Verhalten ([N-009](reqseq:6ad3a133-a4fa-4a32-b108-299779d40b05?version=n1:b4fb2144d129d4bd), [N-010](reqseq:6ad3a134-2f57-4d7f-9a41-13eaa6681093?version=n1:11470c24333dbe06)), die Zugehörigkeit zu einem Paket ([N-014](reqseq:6ad3a38b-de82-4761-a388-5eb0e98bd5ac?version=n1:b0f9e498f2f15bb5), [N-015](reqseq:6ad3a38e-f464-4b39-b1d3-224e5ed3f65c?version=n1:f2d270eec5e2155d), D-040), das Kennzeichen „ungültig“ eines Statuswerts (D-044) und die festen Schlüssel aller Typen, Properties, Beziehungsarten und Statuswerte ([D-043](reqseq:6adc6922-7314-49bd-bfed-ff5f8a7211b4?version=n1:2afec40a822b7839)).

Alles andere legt das Metamodell fest: Typen, Properties und die Namen der Beziehungsarten. Das Tool wird mit einem Standardmodell ausgeliefert.

Grund: Kette, Abdeckung und Indirekter Nachweis lassen sich nur berechnen, wenn das Tool weiß, was Parent und Child sind, egal wie eine Organisation ihre Beziehungen nennt.

Ein Element darf Properties tragen, die sein Typ nicht kennt. Das Tool zeigt sie als Hinweis an, blockiert aber nichts. So bleiben Übergänge bei Änderungen am Metamodell möglich, und falsche Daten fallen trotzdem auf.
