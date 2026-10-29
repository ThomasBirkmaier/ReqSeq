---
id: 6adc6d28-5f68-4cda-a7e1-04bb5a8a3eaf
type: system-requirement
status: draft
title: "Daten eines Stands als JSON liefern"
spec-id: "SR-061"
requirement-type: interface
acceptance-criteria:
  - "Gegeben ein Arbeitsbereich, wenn die Daten über API oder Kommandozeile abgefragt werden, dann liefert das Tool alle Elemente mit Properties, Beziehungen, Fassung, Nachweisstatus und Gültigkeit als JSON."
  - Gegeben eine Auswahl über Filter, Paket, Baseline oder Variante, wenn die Daten abgefragt werden, dann enthält das JSON nur diese Auswahl; bei einer Baseline sind das ihre Elemente im aktuellen Stand, die Fassung zum Zeitpunkt der Baseline zeigt die Baseline selbst (SR-051).
  - "Gegeben die Ausgabe, wenn sie geprüft wird, dann entspricht sie einem mitgelieferten JSON-Schema."
  - Gegeben die Kommandozeile oder die API, wenn die Daten im Format JSON Lines angefordert werden, dann liefern sie ein Element je Zeile.
verification-method: test
topic: "Anbindung und Auswertung"
packages:
  - { id: 5e69295a-2847-469f-9bd4-a11e20ceba9f, version: n1:3b91c1fbe49a06cc, title: "Stufe 4: Nachweise" }
derives-from:
  - { id: 6ad4a041-1888-4e26-831d-6384f51fb612, version: n1:09037f9c134e0487, title: Daten für externe Auswertungen }
based-on:
  - { id: 6ad4a03f-d7cf-4b85-98da-3f4431f33fe7, version: n1:3b96003631ba204b, title: Auswertungen mit externen Werkzeugen }
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n1:ddba1713410acb43, title: Kommandozeile neben der App }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n1:6a8d5db3a8ae28c2, title: API und MCP-Server neben der App }
---

Das Tool muss die Daten eines Stands als JSON nach einem dokumentierten Schema für externe Auswertungen liefern.
