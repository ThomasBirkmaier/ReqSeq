---
id: 6adc6d28-5f68-4cda-a7e1-04bb5a8a3eaf
type: system-requirement
status: approved
title: "Daten eines Stands als JSON liefern"
spec-id: "SR-061"
requirement-type: interface
acceptance-criteria:
  - key: cjrr
    text: Gegeben ein Arbeitsbereich, wenn die Daten über Kommandozeile, API oder MCP-Server abgefragt werden, dann liefert das Tool alle Elemente mit Properties, Beziehungen, Fassung, Nachweisstatus für den Kern und je Variante, Validierungsstatus und Gültigkeit als JSON.
  - key: t65h
    text: Gegeben eine Auswahl über Filter, Paket, Baseline oder Variante, wenn die Daten abgefragt werden, dann enthält das JSON nur diese Auswahl; bei einer Baseline sind das ihre Elemente im aktuellen Stand, die Fassung zum Zeitpunkt der Baseline zeigt die Baseline selbst (SR-051).
  - key: zmv6
    text: Gegeben die Ausgabe, wenn sie geprüft wird, dann entspricht sie einem mitgelieferten JSON-Schema.
  - key: h1db
    text: Gegeben die Kommandozeile oder die API, wenn die Daten im Format JSON Lines angefordert werden, dann liefern sie ein Element je Zeile.
verification-method: test
packages:
  - { id: 17252361-b899-4483-ba2b-baf32da3193e, version: n2:233cd483722ffe08, title: Zugänge und Anbindung }
derives-from:
  - { id: 6ad4a041-1888-4e26-831d-6384f51fb612, version: n1:09037f9c134e0487, title: Daten für externe Auswertungen }
based-on:
  - { id: 6ad4a03f-d7cf-4b85-98da-3f4431f33fe7, version: n2:84d08b2dbd1bf992, title: Auswertungen mit externen Werkzeugen }
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n2:94cfee040d7b0613, title: Kommandozeile neben der Web-Oberfläche }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n2:b68c1780920b121b, title: API und MCP-Server neben Kommandozeile und Web-Oberfläche }
  - { id: 12bb3e5a-c303-4774-9f3b-b61677923a73, version: n2:d9a96fbd731a0369, title: Werkzeuge nur über Dateien }
---

Das Tool muss die Daten eines Stands als JSON nach einem dokumentierten Schema für externe Auswertungen liefern.
