---
id: 6adc6923-8957-4ae9-8e6c-dc5cd1d097c8
type: decision
status: accepted
title: "Ablösen statt löschen"
spec-id: "D-045"
---

Das Tool bietet kein Löschen von Elementen, nur Ablösen: Der Status wird ungültig ([D-044](reqseq:6adc6922-e6d1-4d0a-9617-83d65c71cf7f?version=n1:e15d6e6acdfe3cc8)), und optional zeigt der Nachfolger mit Supersedes auf das abgelöste Element. Eine eigene Beziehung Superseded by gibt es nicht; die Richtung vom alten Element zum Nachfolger ergibt sich aus Supersedes.

Damit sich auch Elemente eines Typs ohne Status ablösen lassen, bekommt ein solcher Typ genau einen Statuswert, der ungültig ist, zum Beispiel Retired. Ein Element dieses Typs ohne Status gilt als aktuell.

Fehlt eine Datei trotzdem, etwa weil sie von Hand gelöscht wurde, behandelt das Tool das wie ein fehlendes Ziel ([N-041](reqseq:6adc4fbc-3b1e-4eb7-8e67-c99900ac6b04?version=n1:3f06f7d1100e3c6f)) und meldet es bei der Prüfung des Bestands.

Grund: Beziehungen und Nachweise bleiben nachvollziehbar.
