---
id: 6adc5318-7e31-4925-b180-ff19c4c61c5f
type: decision
status: accepted
title: "Kein Austausch von Metamodellen"
spec-id: "D-022"
---

Das Tool tauscht keine Metamodelle zwischen Organisationen aus. Jede Organisation behält ihr eigenes. Inhalte von außen kommen per ReqIF und werden über die gespeicherte Zuordnung auf das eigene Metamodell abgebildet ([N-045](logreq:6adc5040-2819-4ec5-a9e9-ad790fd35904?version=n1:526f731b8e4f202f)).

Ändert ein Kunde sein Metamodell, wird die Zuordnung angepasst. Versionen des Metamodells entstehen über den Stand ([D-021](logreq:6adc5317-4e70-4297-942b-10bf39e10d85?version=n1:1b21638ff73567ba)), nicht über eigene Versionsnummern.

Grund: ReqIF funktioniert mit den gängigen Werkzeugen. Nutzen beide Seiten das Tool, reicht es, die Dateien zu kopieren. Ein eigenes Austauschformat wäre eine zusätzliche Funktion ohne Mehrwert.
