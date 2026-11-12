---
id: e6faea96-23af-4d19-bbf0-622baef7e5aa
type: system-requirement
status: approved
title: Einstieg und Anleitungen mit geprüften Beispielen
spec-id: SR-140
rationale: "Annahme der Doku-Strategie mit einer Dokumentation für Nutzer, die erzeugt und geprüft wird, und ihrer Aufnahme in die Spezifikation als Need mit wenigen System Requirements. Die Animation des Einstiegs in der README fordert SR-203. Laufende Beispiele (AK2): Wie gebaut laufen nur die Beispiele der Kommandozeile; die Abläufe für App, API und MCP prüft der Bau auf ihre Namen."
requirement-type: functional
acceptance-criteria:
  - Gegeben der Einstieg, wenn seine Schritte der Reihe nach ausgeführt werden, dann entstehen ein Arbeitsbereich, ein erstes Element und eine erste Kette.
  - Gegeben ein Beispiel der Kommandozeile im Einstieg oder in einer Anleitung, wenn die Dokumentation gebaut wird, dann läuft es gegen die Version, zu der die Dokumentation gehört, und ein fehlschlagendes Beispiel oder eine abweichende Ausgabe verhindert den Bau; in den Abläufen für App, API und MCP prüft der Bau, dass die genannten Befehle, API-Pfade und MCP-Werkzeuge in dieser Version existieren.
  - Gegeben eine Anleitung zu einer Aufgabe, die in App, Kommandozeile, API und MCP möglich ist, wenn sie gelesen wird, dann zeigt sie den Ablauf für jeden dieser Zugänge.
verification-method: test
derives-from:
  - { id: 3826ab28-2019-458a-9170-f14f25591ce1, version: n1:26036afe5f131d21, title: Das Tool ohne fremde Hilfe benutzen lernen }
based-on:
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n2:973ec19c47b64747, title: Nutzerdokumentation aus den Quellen des Tools }
packages:
  - { id: ef531b57-0991-45bf-8a1b-0cce10050063, version: n2:3f74ba2fff156a2d, title: Dokumentation }
---

Das Tool muss einen Einstieg und für häufige Aufgaben je eine knappe Anleitung mitliefern, deren Beispiele der Kommandozeile mit der Version laufen, zu der die Dokumentation gehört, und deren übrige Abläufe nur Befehle, API-Pfade und MCP-Werkzeuge dieser Version nennen.
