---
id: 7c003135-cc59-44fb-bddf-16fdd9fa74b5
type: system-requirement
status: approved
title: Element im anderen Bereich öffnen
spec-id: SR-150
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-31: Ohne geteiltes Fenster soll sich das markierte Element mit „Open to the right“ oder „Open to the left“ auf dieser Seite öffnen lassen, auch aus Graph und Listen. Im geteilten Fenster soll der andere Bereich zeigen, was im aktiven Bereich gerade ausgewählt ist. Annahme zu AK4 und AK5: Nur ein Bereich, der ein Element zeigt, folgt der Auswahl; eine Liste, ein Graph oder eine Paketseite wird nicht ersetzt, damit der Ausgangspunkt der Auswahl erhalten bleibt."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein ungeteiltes Fenster und ein markiertes Element in einem Buffer, etwa ein Knoten im Graph, eine Zeile einer Liste oder eine Relation am Element, wenn der Befehl „Open to the right“ gewählt wird, dann teilt sich das Fenster, der bisherige Buffer bleibt links und aktiv, und das markierte Element öffnet sich rechts als Buffer.
  - Gegeben dasselbe, wenn der Befehl „Open to the left“ gewählt wird, dann öffnet sich das markierte Element links, und der bisherige Buffer steht rechts und bleibt aktiv.
  - Gegeben ein geteiltes Fenster, wenn „Open to the right“ oder „Open to the left“ gewählt wird, dann öffnet sich das markierte Element im Bereich auf dieser Seite, und der Bereich mit dem markierten Element bleibt aktiv.
  - Gegeben ein geteiltes Fenster, dessen anderer Bereich ein Element zeigt, wenn im aktiven Bereich ein anderes Element markiert wird, dann zeigt der andere Bereich dieses Element, ohne dass der aktive Bereich wechselt.
  - Gegeben ein geteiltes Fenster, dessen anderer Bereich eine Liste, einen Graph oder eine Paketseite zeigt, wenn im aktiven Bereich ein Element markiert wird, dann bleibt der andere Bereich unverändert.
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
verification-method: test
topic: Bearbeiten und Finden
derives-from:
  - { id: 61d4ffa4-bfc0-42c8-a7ef-d867c0ba286c, version: n1:49c90a7abf6c0e3c, title: Befehle finden und Kürzel lernen }
  - { id: d546b567-fda6-410d-a379-78deec04bfe2, version: n1:ff4acfc7f0085726, title: Nur Aussagekräftiges sehen }
based-on:
  - { id: c14efb7d-59da-4ef5-9b85-626310b9a57e, version: n1:fdb39689e8cfdeb5, title: Oberfläche als weißes Blatt }
---

Die App muss das markierte Element per Befehl in einem Bereich neben dem aktuellen öffnen und im geteilten Fenster den anderen Bereich dem markierten Element folgen lassen.
