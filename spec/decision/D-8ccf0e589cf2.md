---
id: 6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2
type: decision
status: accepted
title: "Automatisch erzeugte, zufällige IDs"
spec-id: "D-017"
supersedes:
  - { id: 6ad4f79f-3859-4d3d-9d4b-b6b9d3fd8f46, version: n1:7f5f7d3d39e725df, title: "Automatisch erzeugte, eindeutige IDs" }
---

Jedes Element bekommt beim Anlegen automatisch eine UUID (Version 4), die nie geändert wird. Alle Beziehungen und Verweise speichern sie vollständig.

Angezeigt wird eine Kurzform aus den letzten Zeichen, mit Mindestlänge. Ist sie nicht eindeutig, wird sie verlängert. Davor steht ein Präfix, das jeder Typ im Metamodell festlegt, zum Beispiel SR-.

IDs aus anderen Quellen, zum Beispiel von Kunden oder aus einem anderen Werkzeug, stehen in einer eigenen Property mit der Bedeutung Kennung. Eine Kennung ist je Typ eindeutig. Das Tool findet ein Element auch über seine Kennung und zeigt sie neben der Kurz-ID.

Grund: Von Hand vergebene IDs werden uneinheitlich geschrieben. Fortlaufende Zähler kollidieren ohne zentralen Server. UUIDs sind ohne Abstimmung eindeutig. Die ID darf nichts über das Element verraten, weder Zeitpunkt noch Reihenfolge, auch nicht in Repositories mit anderem Need-to-know. UUID v7 enthält den Zeitpunkt der Erstellung.
