---
id: 6ad4f54c-89d0-4f42-9ef5-5ee2bf8ae80c
type: decision
status: accepted
title: "Varianten nicht über Git-Branches"
spec-id: "D-010"
---

Varianten werden im Datenmodell abgebildet, nicht über Git-Branches. Branches dienen nur der Änderungsarbeit und werden per Merge Request zusammengeführt.

Grund: Branches trennen Zeit, Varianten bestehen dauerhaft nebeneinander. Varianten als Branches führen zu Kopien, die auseinanderlaufen.

Folge: Welche Requirements für eine Variante gelten, ergibt sich aus dem gemeinsamen Datenmodell. Es gibt keine Kopie pro Variante.
