---
id: 6adc6923-8957-4ae9-8e6c-dc5cd1d097c8
type: decision
status: accepted
title: "Ablösen statt löschen"
spec-id: "D-045"
---

Das Tool bietet kein Löschen von Elementen, nur Ablösen: Der Status wird ungültig ([D-044](reqseq:6adc6922-e6d1-4d0a-9617-83d65c71cf7f?version=n2:a015fc3f832d33fc)), und optional zeigt der Nachfolger mit Supersedes auf das abgelöste Element. Eine eigene Beziehung Superseded by gibt es nicht; die Richtung vom alten Element zum Nachfolger ergibt sich aus Supersedes.

Damit sich auch Elemente eines Typs ohne Status ablösen lassen, bekommt ein solcher Typ genau einen Statuswert, der ungültig ist, zum Beispiel Retired. Ein Element dieses Typs ohne Status gilt als aktuell.

Fehlt eine Datei trotzdem, etwa weil sie von Hand gelöscht wurde, behandelt das Tool das wie ein fehlendes Ziel ([N-041](reqseq:6adc4fbc-3b1e-4eb7-8e67-c99900ac6b04?version=n1:3f06f7d1100e3c6f)) und meldet es bei der Prüfung des Bestands.

Ein Element im Status Draft, das nie den Status Approved hatte und in keiner Baseline steht, darf der Nutzer außerhalb des Tools mit Git entfernen; Beziehungen, die danach noch auf es zeigen, meldet die Prüfung des Bestands als fehlendes Ziel (Entscheidung des Produktverantwortlichen, 2026-11-09). Draft und Approved sind hier die Statuswerte des Standardmodells ([D-030](reqseq:6adc615b-272a-4377-82e5-9ae991d75bb2?version=n2:5086a4bc7d6ff7de)); in einem eigenen Metamodell gilt die Regel für die Statuswerte, die ihnen dort entsprechen. Das Tool prüft sie nicht.

Grund: Beziehungen und Nachweise bleiben nachvollziehbar.
