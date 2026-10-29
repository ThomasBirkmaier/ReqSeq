---
id: e6faea96-23af-4d19-bbf0-622baef7e5aa
type: system-requirement
status: approved
title: Einstieg und Anleitungen mit geprüften Beispielen
spec-id: SR-140
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-29: Annahme der Doku-Strategie mit einer Dokumentation für Nutzer, die erzeugt und geprüft wird, und ihrer Aufnahme in die Spezifikation als Need mit wenigen Systemanforderungen."
requirement-type: functional
acceptance-criteria:
  - Gegeben der Einstieg, wenn seine Schritte der Reihe nach ausgeführt werden, dann entstehen ein Arbeitsbereich, ein erstes Element und eine erste Kette.
  - Gegeben ein Beispiel im Einstieg oder in einer Anleitung, wenn die Dokumentation gebaut wird, dann läuft es gegen die Version, zu der die Dokumentation gehört, und ein fehlschlagendes Beispiel verhindert den Bau.
  - Gegeben eine Anleitung zu einer Aufgabe, die in App, Kommandozeile, API und MCP möglich ist, wenn sie gelesen wird, dann zeigt sie den Ablauf für jeden dieser Zugänge.
verification-method: test
topic: Betrieb und Leistung
derives-from:
  - { id: 3826ab28-2019-458a-9170-f14f25591ce1, version: n1:26036afe5f131d21, title: Das Tool ohne fremde Hilfe benutzen lernen }
based-on:
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n1:44f219796afc9c64, title: Nutzerdokumentation aus den Quellen des Werkzeugs }
packages:
  - { id: 7a12a8c7-43e7-4349-9453-0ac2b6d5157d, version: n1:8c09ff1853730c25, title: Querschnitt }
---

Das Tool muss einen Einstieg und für häufige Aufgaben je eine knappe Anleitung mitliefern, deren Beispiele mit der Version laufen, zu der die Dokumentation gehört.
