---
id: 6ad4f79f-3859-4d3d-9d4b-b6b9d3fd8f46
type: decision
status: superseded
title: "Automatisch erzeugte, eindeutige IDs"
spec-id: "D-011"
---

Jedes Element bekommt beim Anlegen automatisch eine UUID (Version 7), die nie geändert wird. Alle Beziehungen und Verweise speichern sie vollständig.

Angezeigt wird eine Kurzform aus den letzten Zeichen, mit Mindestlänge. Ist sie nicht eindeutig, wird sie verlängert. Davor steht ein Präfix, das jeder Typ im Metamodell festlegt, zum Beispiel SR-.

IDs aus anderen Quellen, zum Beispiel von Kunden, stehen in einer eigenen Property.

Grund: Von Hand vergebene IDs werden uneinheitlich geschrieben. Fortlaufende Zähler kollidieren ohne zentralen Server. UUIDs sind ohne Abstimmung eindeutig.
