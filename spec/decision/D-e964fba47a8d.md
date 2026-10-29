---
id: 6adc4eb0-23e6-4e81-9ae8-e964fba47a8d
type: decision
status: accepted
title: "Zusammenarbeit liegt außerhalb des Tools"
spec-id: "D-014"
---

Gleichzeitiges Arbeiten, Abgleich, Konfliktlösung, Review und Historie übernehmen die Versionsverwaltung und die vorhandenen Werkzeuge, zum Beispiel GitLab. Das Tool bietet dafür keine eigenen Funktionen.

Grund: Dafür gibt es erprobte Werkzeuge. Eine klare Grenze hält das Tool klein und die Architektur sauber. Folgt aus [D-024](reqseq:6adc5a79-32fa-4834-88e9-f88d296ea3f1?version=n1:cfec41db4d2067b9) und [D-002](reqseq:6ad39064-0c17-44eb-b1b3-069ebda57ac6?version=n1:9c540adec22e0e1f). Wie bei Code: Auch eine IDE zeigt nicht an, ob jemand anders gerade dieselbe Datei ändert.
