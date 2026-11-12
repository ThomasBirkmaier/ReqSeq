---
id: 1c987832-234f-4c88-a8bf-dd4b4f6c54d8
type: system-requirement
status: approved
title: Dokumentation ohne Netz mit jeder Auslieferung
spec-id: SR-141
rationale: "Annahme der Doku-Strategie mit einer Dokumentation für Nutzer, die erzeugt und geprüft wird, und ihrer Aufnahme in die Spezifikation als Need mit wenigen System Requirements. Dokumentation im Standardbrowser über einen Dienst auf dem eigenen Rechner, ohne eigenes Fenster; die App selbst läuft nicht im Browser (D-003). Host `localhost` (AK4, #1458): Annahme bestätigt; der Name zeigt wie eine Loopback-Adresse auf denselben Rechner."
requirement-type: functional
acceptance-criteria:
  - key: k4fs
    text: Gegeben eine entpackte Auslieferung ohne Netzverbindung, wenn ihre Dokumentation geöffnet und durchsucht wird, dann zeigt sie die Seiten und Suchtreffer der Version dieser Auslieferung.
  - key: g8dv
    text: Gegeben die App, wenn die Hilfe aus dem Menü aufgerufen wird, dann öffnet sie die mitgelieferte Dokumentation im Standardbrowser über den Dienst für die Dokumentation auf dem eigenen Rechner (AK4), nicht in einem eigenen Fenster.
  - key: c1s5
    text: Gegeben eine Funktion in der Befehlszeile der App, wenn ihre Hilfe aufgerufen wird, dann öffnet die App die Referenzseite dieser Funktion, bei einem Befehl, den es nur in der App gibt, seine Stelle in der Tastenreferenz der Dokumentation (SR-139 AK6).
  - key: dbrz
    text: Gegeben der Dienst für die Dokumentation läuft, von `reqseq serve docs` oder von der Hilfe der App gestartet, wenn die Dokumentation damit gelesen und durchsucht wird, dann ist er nur auf 127.0.0.1 erreichbar, beantwortet nur Lese-Anfragen (GET, HEAD), lehnt eine Anfrage ab, deren Host nicht eine Loopback-Adresse oder `localhost` mit seinem Port nennt, schreibt nichts, lässt außer dem Port nichts wählen, und seine Seiten laden nichts aus dem Netz.
verification-method: test
derives-from:
  - { id: 3826ab28-2019-458a-9170-f14f25591ce1, version: n1:26036afe5f131d21, title: Das Tool ohne fremde Hilfe benutzen lernen }
  - { id: 6adc50a3-2395-4867-bc28-4ac6a3af2b01, version: n1:530a8654e612e857, title: Offline arbeiten }
  - { id: 6adc50a4-2ab6-4b5b-a5b2-48eda43df08c, version: n1:943c6e5551cb785c, title: Abgeschottete Netze }
based-on:
  - { id: cb583de8-288a-4d8a-82f0-b2be57da2cce, version: n2:973ec19c47b64747, title: Nutzerdokumentation aus den Quellen des Tools }
packages:
  - { id: ef531b57-0991-45bf-8a1b-0cce10050063, version: n2:de4346c0dff1f5d3, title: Dokumentation }
---

Das Tool muss seine Dokumentation in der Ausgabe seiner Version mit jeder Auslieferung mitliefern, ohne Netzverbindung lesbar und durchsuchbar, und sie aus der App heraus öffnen, zu einer Funktion direkt auf deren Referenzseite.
