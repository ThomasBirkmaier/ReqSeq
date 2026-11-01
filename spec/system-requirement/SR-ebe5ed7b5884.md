---
id: 66fdf1f3-ba3e-4a81-a721-ebe5ed7b5884
type: system-requirement
status: draft
title: Fassungsdatum auch für Bilder, die der Checkout verändert (Git LFS, Zeilenenden)
spec-id: SR-159
rationale: "Entscheidung des Produktverantwortlichen, 2026-11-01: Wunsch für nach 1.0, im Paket Später geparkt. Heute zeigt ein solches Element kein Datum, sondern „nicht committet“, obwohl sein Inhalt committet ist, denn ein eingebettetes Bild zählt beim Commit mit seinem in Git gespeicherten Inhalt, der sich von der Arbeitskopie unterscheidet. Nach D-013 wird das Datum der Fassung angezeigt."
requirement-type: functional
acceptance-criteria:
  - Gegeben ein committetes Element, das ein Bild in Git LFS einbettet, wenn seine Fassung angezeigt wird, dann zeigt das Tool das Datum des Commits und nicht „nicht committet“.
  - Gegeben ein committetes Element, das ein SVG einbettet, dessen Zeilenenden beim Checkout umgewandelt werden (`core.autocrlf` oder Attribut `text`), wenn seine Fassung angezeigt wird, dann zeigt das Tool das Datum des Commits und nicht „nicht committet“.
  - Gegeben ein solches Element, wenn das Datum seiner Fassung bestimmt wird, dann startet das Tool kein Filterprogramm des Checkouts und öffnet keine Netzverbindung.
packages:
  - { id: c64ee86d-761a-4180-bfb1-cde819bfc27c, version: n1:fd3ed3f03b3d762f, title: Später }
verification-method: test
topic: Traceability und Ketten
issue: "#143"
based-on:
  - { id: 6adc4946-b44c-4ae1-8dbf-fb9e88b8c607, version: n1:0c3f2da31ca1ae9a, title: Fassung als Prüfwert über den Inhalt }
  - { id: 6adc691d-c3f6-4d51-a053-72a341032941, version: n1:d9ab6ac4aab20571, title: Das Tool liest Git nur }
---

Das Tool muss das Datum der Fassung eines committeten Elements, das ein Bild einbettet, auch dann zeigen, wenn der Checkout das Bild gegenüber dem in Git gespeicherten Inhalt verändert, etwa bei Git LFS oder bei der Umwandlung der Zeilenenden.
