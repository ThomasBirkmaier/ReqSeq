---
id: 6ad4ffaa-f5ad-494e-97eb-a4c77c54dccc
type: decision
status: accepted
title: "Fest eingebaute Bedeutungen des Metamodells"
spec-id: "D-012"
---

Einige Bedeutungen sind fest eingebaut und lassen sich nicht ändern: Jedes Element hat ID und Typ; welche Statuswerte es haben kann, legt sein Typ fest ([D-030](reqseq:6adc615b-272a-4377-82e5-9ae991d75bb2?version=n2:b07fd599a8a95fa1), [D-045](reqseq:6adc6923-8957-4ae9-8e6c-dc5cd1d097c8?version=n2:ccc6f475b16bca88)). Jede Beziehungsart ist entweder eine Parent-Child-Beziehung oder hat keine Bedeutung für die Traceability. Ein Nachweis verweist immer auf ein Requirement, eine Validierung auf einen Need oder ein Requirement.

Ebenfalls fest eingebaut sind: die Gültigkeit eines Requirements und die Beziehung „ersetzt“ ([D-020](reqseq:6adc5316-641d-4817-964e-8803a78ac710?version=n2:0cd25f27b89543f2)), das Kennzeichen, ob eine Property zum Inhalt gehört ([D-013](reqseq:6adc4946-b44c-4ae1-8dbf-fb9e88b8c607?version=n2:fa0fbf62535d1e3c)), das Kennzeichen für Emergentes Verhalten ([N-009](reqseq:6ad3a133-a4fa-4a32-b108-299779d40b05?version=n1:b4fb2144d129d4bd), [N-010](reqseq:6ad3a134-2f57-4d7f-9a41-13eaa6681093?version=n1:11470c24333dbe06)), die Zugehörigkeit zu einem Paket ([N-014](reqseq:6ad3a38b-de82-4761-a388-5eb0e98bd5ac?version=n2:b0db2781054ca671), [N-015](reqseq:6ad3a38e-f464-4b39-b1d3-224e5ed3f65c?version=n2:c32cdef663dc7eba), [D-040](reqseq:6adc6920-0efc-478d-b91c-4ca42caaa8a8?version=n2:e84656cd8b820df6)), die Akzeptanzkriterien eines Requirements ([D-072](reqseq:3d5793a1-a4d5-493c-892b-c1b1dded5eca?version=n2:6ee1dcf2cf64f9cc)), das Kennzeichen „ungültig“ eines Statuswerts ([D-044](reqseq:6adc6922-e6d1-4d0a-9617-83d65c71cf7f?version=n2:35c88f8ea78aa261)) und die festen Schlüssel aller Typen, Properties, Beziehungsarten und Statuswerte ([D-043](reqseq:6adc6922-7314-49bd-bfed-ff5f8a7211b4?version=n1:2afec40a822b7839)).

Alles andere legt das Metamodell fest: Typen, Properties und die Namen der Beziehungsarten. Das Tool wird mit einem Standardmodell ausgeliefert.

Grund: Kette, Abdeckung und Indirekter Nachweis lassen sich nur berechnen, wenn das Tool weiß, was Parent und Child sind, egal wie eine Organisation ihre Beziehungen nennt.

Ein Element darf Properties tragen, die sein Typ nicht kennt. Das Tool zeigt sie als Hinweis an, blockiert aber nichts. So bleiben Übergänge bei Änderungen am Metamodell möglich, und falsche Daten fallen trotzdem auf.
