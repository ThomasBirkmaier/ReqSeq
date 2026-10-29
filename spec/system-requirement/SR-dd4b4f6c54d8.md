---
id: 1c987832-234f-4c88-a8bf-dd4b4f6c54d8
type: system-requirement
status: approved
title: Dokumentation ohne Netz mit jeder Auslieferung
spec-id: SR-141
rationale: "Entscheidung des Produktverantwortlichen, 2026-10-29: Annahme der Doku-Strategie mit einer Dokumentation für Nutzer, die erzeugt und geprüft wird, und ihrer Aufnahme in die Spezifikation als Need mit wenigen Systemanforderungen."
requirement-type: functional
acceptance-criteria:
  - Gegeben eine entpackte Auslieferung ohne Netzverbindung, wenn ihre Dokumentation geöffnet und durchsucht wird, dann zeigt sie die Seiten und Suchtreffer der Version dieser Auslieferung.
  - Gegeben die App, wenn die Hilfe aus dem Menü aufgerufen wird, dann öffnet sie die mitgelieferte Dokumentation.
  - Gegeben eine Funktion in der Befehlszeile der App, wenn ihre Hilfe aufgerufen wird, dann öffnet die App die Referenzseite dieser Funktion.
verification-method: test
topic: Betrieb und Leistung
derives-from:
  - { id: 3826ab28-2019-458a-9170-f14f25591ce1, version: n1:26036afe5f131d21, title: Das Tool ohne fremde Hilfe benutzen lernen }
  - { id: 6adc50a3-2395-4867-bc28-4ac6a3af2b01, version: n1:530a8654e612e857, title: Offline arbeiten }
  - { id: 6adc50a4-2ab6-4b5b-a5b2-48eda43df08c, version: n1:943c6e5551cb785c, title: Abgeschottete Netze }
based-on:
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n1:44f219796afc9c64, title: Nutzerdokumentation aus den Quellen des Werkzeugs }
packages:
  - { id: 7a12a8c7-43e7-4349-9453-0ac2b6d5157d, version: n1:8c09ff1853730c25, title: Querschnitt }
---

Das Tool muss seine Dokumentation in der Fassung seiner Version mit jeder Auslieferung mitliefern, ohne Netzverbindung lesbar und durchsuchbar, und sie aus der App heraus öffnen, zu einer Funktion direkt auf deren Referenzseite.
