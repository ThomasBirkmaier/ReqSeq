---
id: 6adc6d28-5f68-4cda-a7e1-04bb5a8a3eaf
type: system-requirement
status: draft
title: "Daten eines Stands als JSON liefern"
spec-id: "SR-061"
requirement-type: interface
acceptance-criteria:
  - "Gegeben ein Arbeitsbereich, wenn die Daten über API oder Kommandozeile abgefragt werden, dann liefert das Tool alle Elemente mit Properties, Beziehungen, Fassung, Nachweisstatus und Gültigkeit als JSON."
  - "Gegeben eine Auswahl über Filter, Paket, Baseline oder Variante, wenn die Daten abgefragt werden, dann enthält das JSON nur diese Auswahl."
  - "Gegeben die Ausgabe, wenn sie geprüft wird, dann entspricht sie einem mitgelieferten JSON-Schema."
  - Gegeben ein Requirement, dessen Nachweisstatus in einer Variante, in der es gilt, dem Status im Kern gleicht, wenn die Daten abgefragt werden, dann enthält das JSON für diese Variante keinen eigenen Eintrag; fehlt der Eintrag einer solchen Variante, gilt der Status des Kerns.
  - Gegeben die Kommandozeile, wenn die Daten im Format JSON Lines angefordert werden, dann liefert sie ein Element je Zeile.
verification-method: test
topic: "Anbindung und Auswertung"
packages:
  - { id: 5e69295a-2847-469f-9bd4-a11e20ceba9f, version: n1:89fcc971400d045e, title: "Stufe 4: Nachweise" }
derives-from:
  - { id: 6ad4a041-1888-4e26-831d-6384f51fb612, version: n1:56ffda612543768f, title: Daten für externe Auswertungen }
based-on:
  - { id: 6ad4a03f-d7cf-4b85-98da-3f4431f33fe7, version: n1:e6f4415854befb32, title: Auswertungen mit externen Werkzeugen }
  - { id: 6adc58f4-fbf7-4c3d-84da-de15d00286a2, version: n1:aa83cee4e109580c, title: Kommandozeile neben der App }
  - { id: 6adc5c64-fe36-4191-85d8-c57756a89310, version: n1:240f9a68d1d72cf8, title: API und MCP-Server neben der App }
---

Das Tool muss die Daten eines Stands als JSON nach einem dokumentierten Schema für externe Auswertungen liefern.
